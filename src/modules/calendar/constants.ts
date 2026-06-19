export const KST_OFFSET_MIN = 540; // UTC+9, DST 없음
export const WEEK_STARTS_ON = 0; // 0=일요일. 월 그리드 주 시작의 단일 출처
export const DEFAULT_GOOGLE_TTL_SEC = 900; // CalendarSource.cacheTtlSeconds 기본
export const HOLIDAY_TTL_SEC = 86_400; // 공휴일 24h
export const MIN_REFRESH_INTERVAL_SEC = 30; // 강제 새로고침 해머링 차단(§12.4)
export const MAX_ANCHOR_MONTHS = 12; // feed/refresh 앵커 허용 창(now 기준 ±개월) — 무제한 달 열거로 인한 외부 호출·캐시 증가 차단(§12.4)
export const EXTERNAL_FETCH_TIMEOUT_MS = 8_000; // 외부(Google) 소스 1건 fetch 상한 — 멈춘 의존성이 feed 전체를 막지 않게 timeout→failed 환원(적대적 리뷰)
export const LEAVE_KEYWORDS = ["휴가", "연차", "반차", "오전반차", "오후반차"] as const;
