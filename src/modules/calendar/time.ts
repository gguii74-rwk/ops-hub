import { KST_OFFSET_MIN, WEEK_STARTS_ON } from "./constants";
import type { NormalizedRange } from "./types";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const OFFSET_MS = KST_OFFSET_MIN * MS_PER_MIN;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// d를 "KST 벽시계를 UTC인 것처럼" 본 Date (계산 보조용 — 외부 노출 금지)
function shiftToKst(d: Date): Date {
  return new Date(d.getTime() + OFFSET_MS);
}

export function toKstDateKey(d: Date): string {
  const s = shiftToKst(d);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
}

export function kstDayStartUtc(d: Date): Date {
  const s = shiftToKst(d);
  const dayStartShifted = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return new Date(dayStartShifted - OFFSET_MS);
}

export function allDayHalfOpen(startInclusive: Date, endInclusive: Date): { start: Date; end: Date } {
  return {
    start: kstDayStartUtc(startInclusive),
    end: new Date(kstDayStartUtc(endInclusive).getTime() + MS_PER_DAY),
  };
}

export function normalizeToGridWindow(anchor: Date): NormalizedRange {
  const s = shiftToKst(anchor);
  const year = s.getUTCFullYear();
  const month = s.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dow = firstOfMonth.getUTCDay(); // 0..6 (KST 기준)
  const back = (dow - WEEK_STARTS_ON + 7) % 7;
  const gridStartShifted = Date.UTC(year, month, 1 - back);
  const start = new Date(gridStartShifted - OFFSET_MS);
  const end = new Date(start.getTime() + 42 * MS_PER_DAY);
  return { start, end };
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

// 앵커가 now 기준 ±maxMonths 개월(KST 월 기준) 안인지. feed/refresh 라우트 입력 검증 — 무제한 달 열거 차단(적대적 리뷰).
export function isAnchorWithinWindow(anchor: Date, now: Date, maxMonths: number): boolean {
  const a = shiftToKst(anchor);
  const n = shiftToKst(now);
  const months = (a.getUTCFullYear() - n.getUTCFullYear()) * 12 + (a.getUTCMonth() - n.getUTCMonth());
  return Math.abs(months) <= maxMonths;
}
