// 캘린더 공통 이벤트 모델 — 도메인(CalEvent/Ev)→이 모델 변환은 각 소비처 어댑터(D2).
// 날짜 범위는 half-open [start, end) instant(KST 일자 기준). D14.

export type Intensity = "soft" | "bold";

export type EventStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface CalendarEventInput {
  id: string;
  title: string;
  kind: string; // 색 키(KIND_STYLES, D4). 자유 문자열, 미등록 시 중립 폴백.
  start: string; // ISO instant — half-open 범위 시작(포함). D14.
  end?: string; // ISO instant — half-open 범위 끝(제외). 생략 = 단일일 [kstDayStart, +1일). D14.
  status?: EventStatus | null; // 오버레이(D5). 색과 직교.
}
