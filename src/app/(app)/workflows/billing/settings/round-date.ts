import { toKstFields } from "@/modules/workflows/billing/period";

// date input "YYYY-MM-DD" → KST 자정 기준 UTC ISO(...Z). 백엔드 billingRoundDateUpdateSchema(z.string().datetime())가 UTC Z를 요구(D11).
export function dateInputToSubmitDateIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+09:00`).toISOString();
}

// 저장된 UTC ISO → date input "YYYY-MM-DD"(KST 환원, 표시용).
export function submitDateIsoToDateInput(iso: string): string {
  const s = toKstFields(new Date(iso));
  return `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`;
}
