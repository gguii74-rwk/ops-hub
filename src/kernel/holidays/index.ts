import { prisma } from "@/lib/prisma";
import { fetchHolidays } from "@/lib/integrations/holidays";

/** [start, end] 범위의 공휴일을 "YYYY-MM-DD"(UTC) Set으로. 빈 결과 정상. */
export async function getHolidaysInRange(start: Date, end: Date): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

/** 공공데이터 특일정보에서 해당 연도 공휴일을 가져와 단일 트랜잭션으로 upsert. 반환값은 적재된 공휴일 건수(트랜잭션 커밋 완료 의미, 실패 시 throw). */
export async function syncHolidaysForYear(year: number): Promise<number> {
  const holidays = await fetchHolidays(year); // 네트워크는 트랜잭션 밖에서 먼저
  await prisma.$transaction(async (tx) => {
    for (const h of holidays) {
      const date = new Date(`${h.date}T00:00:00.000Z`);
      await tx.holiday.upsert({ where: { date }, update: { name: h.name, year }, create: { date, name: h.name, year } });
    }
  });
  return holidays.length;
}

/** 미적재(count===0) 연도만 sync. 실패는 로그 후 진행(부팅을 막지 않음). */
export async function ensureYearsSynced(years: number[]): Promise<void> {
  for (const year of years) {
    try {
      if ((await prisma.holiday.count({ where: { year } })) === 0) {
        const n = await syncHolidaysForYear(year);
        console.log(`[holidays] ${year}년 공휴일 ${n}건 동기화`);
      }
    } catch (e) {
      console.error(`[holidays] ${year}년 동기화 실패(무시):`, e);
    }
  }
}

/** 인자 연도 중 여전히 미적재(count===0)인 연도 반환. fail-closed 게이트(직원 신청)·admin 미적재 알림용. */
export async function getUnsyncedYears(years: number[]): Promise<number[]> {
  const result: number[] = [];
  for (const year of years) {
    if ((await prisma.holiday.count({ where: { year } })) === 0) result.push(year);
  }
  return result;
}
