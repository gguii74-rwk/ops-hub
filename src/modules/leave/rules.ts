import type { LeaveType } from "@prisma/client";
import { LeaveValidationError } from "./errors";

/** UTC ISO 날짜 키 "YYYY-MM-DD". */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → UTC 자정 Date. 형식·유효성 위반 시 LeaveValidationError. */
export function parseLeaveDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new LeaveValidationError(`날짜 형식이 올바르지 않습니다: ${s}`);
  const date = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new LeaveValidationError(`유효하지 않은 날짜입니다: ${s}`);
  // 캘린더 유효성: "2026-02-30" 같은 입력은 V8이 자동으로 3월로 파싱하므로 재검증
  if (toDateKey(date) !== s) throw new LeaveValidationError(`유효하지 않은 날짜입니다: ${s}`);
  return date;
}

/** ANNUAL=주말·공휴일 제외 일수, HALF=0.5, QUARTER=0.25. UTC 기준 결정적. */
export function calculateLeaveDays(leaveType: LeaveType, start: Date, end: Date, holidays: Set<string>): number {
  if (leaveType === "HALF") return 0.5;
  if (leaveType === "QUARTER") return 0.25;
  let count = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cur.getTime() <= last) {
    const day = cur.getUTCDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6 && !holidays.has(toDateKey(cur))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** 직원: 과거 신청 불가 + start>end 불가. */
export function validateDates(start: Date, end: Date, today: Date): void {
  if (start.getTime() > end.getTime()) throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
  if (toDateKey(start) < toDateKey(today)) throw new LeaveValidationError("과거 날짜에는 연차를 신청할 수 없습니다.");
}

/** 관리자: start>end만 불가(과거 허용, 단일일도 가능). */
export function validateDatesForAdmin(start: Date, end: Date): void {
  if (start.getTime() > end.getTime()) throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
}

/** HALF/QUARTER는 단일일만. */
export function validateLeaveTypeDates(leaveType: LeaveType, start: Date, end: Date): void {
  if ((leaveType === "HALF" || leaveType === "QUARTER") && toDateKey(start) !== toDateKey(end)) {
    throw new LeaveValidationError(`${leaveType === "HALF" ? "반차" : "반반차"}는 하루만 선택할 수 있습니다.`);
  }
}

/** 이월 만료 = 익년 6/30(UTC 자정). */
export function calculateCarriedOverExpiry(year: number): Date {
  return new Date(Date.UTC(year + 1, 5, 30));
}

/** 현재 KST 날짜를 UTC 자정 Date로(validateDates·취소 게이트의 today 인자용). */
export function kstToday(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}
