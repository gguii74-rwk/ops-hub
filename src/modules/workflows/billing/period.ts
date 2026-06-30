// 순수함수(server-only 불필요 — DOM/Prisma 미접근). 단위 테스트 1층 대상.
// KST = UTC+9, DST 없음. calendar 모듈을 import하지 않고 같은 규약을 self-contained로 재현한다(boundaries).

export const KST_OFFSET_MIN = 540;
const KST_OFFSET_MS = KST_OFFSET_MIN * 60_000;

// instant → KST 벽시계 캘린더 필드(month/day 1-based). getUTC*만 쓰므로 서버 TZ와 무관.
export function toKstFields(d: Date): { year: number; month: number; day: number } {
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

// (year, month1=1-based)의 말일. 달력 산술이라 TZ 무관. Date.UTC(y, month1, 0) = month1월의 말일.
export function getLastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// 청구 instant → 사업년도(전월의 연도, KST) + 회차(전월의 월, 1~12) + 청구일 instant.
// 전월 = KST 캘린더의 직전 달. 1월분 청구 = 12회차(전년). 1월 KST면 전월은 전년 12월.
export function computeBillingPeriod(scheduledAt: Date): {
  projectYear: number;
  round: number;
  billingDate: Date;
} {
  const { year, month } = toKstFields(scheduledAt); // month 1-based, KST
  const prevMonth = month === 1 ? 12 : month - 1;
  const projectYear = month === 1 ? year - 1 : year;
  return { projectYear, round: prevMonth, billingDate: scheduledAt };
}
