# Task 01 — 공통 타입·상수·KST/range 유틸

캘린더 도메인의 기반: enum 재사용 타입, 상수, view 매핑, 그리고 **순수 함수**인 KST 날짜·6주 그리드 범위·overlap 유틸. 이후 모든 태스크가 여기에 의존한다.

## Files

- Create: `src/modules/calendar/constants.ts`
- Create: `src/modules/calendar/types.ts`
- Create: `src/modules/calendar/views.ts`
- Create: `src/modules/calendar/time.ts`
- Test: `tests/modules/calendar/time.test.ts`

## Prep

- Spec: `docs/specs/2026-06-19-phase-3-calendar-design.md` §5(타입), §11(timezone/all-day), §12.2(range 정규화).
- 엔트리포인트 §Shared Contracts의 상수·타입·views·time 시그니처가 이 태스크의 산출이다(여기서 구현, 다른 태스크는 import).

## Deps

없음.

## Steps

### 1. 상수·타입·views 작성 (선언부 — 테스트 불필요, typecheck로 검증)

`src/modules/calendar/constants.ts`:

```ts
export const KST_OFFSET_MIN = 540; // UTC+9, DST 없음
export const WEEK_STARTS_ON = 0; // 0=일요일. 월 그리드 주 시작의 단일 출처
export const DEFAULT_GOOGLE_TTL_SEC = 900; // CalendarSource.cacheTtlSeconds 기본
export const HOLIDAY_TTL_SEC = 86_400; // 공휴일 24h
export const MIN_REFRESH_INTERVAL_SEC = 30; // 강제 새로고침 해머링 차단(§12.4)
export const MAX_ANCHOR_MONTHS = 12; // feed/refresh 앵커 허용 창(now 기준 ±개월) — 무제한 달 열거로 인한 외부 호출·캐시 증가 차단(§12.4)
export const LEAVE_KEYWORDS = ["휴가", "연차", "반차", "오전반차", "오후반차"] as const;
```

`src/modules/calendar/types.ts`:

```ts
import type { CalendarEventKind, CalendarDedupStatus } from "@prisma/client";

export type ViewKey = "work" | "leave" | "personal" | "team" | "admin";

export interface NormalizedRange {
  start: Date;
  end: Date;
}

export interface RawEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
  externalId: string | null;
  dedupStatus: CalendarDedupStatus;
  duplicateOfId: string | null;
  tentative: boolean; // 미승인(PENDING) 휴가 등 잠정 일정. 본인·admin만 노출, dedup 앵커 제외(§10)
}

export interface CalEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
  dedupStatus: CalendarDedupStatus;
  masked: boolean;
  tentative: boolean; // 잠정(미승인) 일정 — UI가 별도 스타일로 표시
}

export interface SourceStatus {
  key: string;
  state: "ok" | "stale" | "failed";
  lastFetchedAt: string | null;
  error: string | null;
}

export interface FeedResponse {
  events: CalEvent[];
  sources: SourceStatus[];
  staleSources: string[];
  failedSources: string[];
}

export interface FeedContext {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
}

export interface SourceResult {
  events: RawEvent[];
  statuses: SourceStatus[];
}

export interface CalendarSourceProvider {
  key: string;
  fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<SourceResult>;
}
```

`src/modules/calendar/views.ts`:

```ts
import type { ViewKey } from "./types";

export const VIEW_PERMISSION: Record<ViewKey, string> = {
  work: "calendar.work",
  leave: "calendar.leave",
  personal: "calendar.personal",
  team: "calendar.team",
  admin: "calendar.admin",
};

export const UI_VIEWS: ViewKey[] = ["work", "leave", "personal"];

export const VIEW_SOURCES: Record<ViewKey, string[]> = {
  work: ["workflowTask", "internalLeave", "holiday"],
  leave: ["internalLeave", "google", "holiday"],
  personal: ["internalLeave", "manual", "google", "holiday"], // workflowTask 제외(사용자 귀속 없는 조직 일정). feed가 본인 소유+공휴일만 통과(§9 personal 스코프)
  team: ["workflowTask", "internalLeave", "holiday"],
  admin: ["internalLeave", "workflowTask", "manual", "google", "holiday"],
};

export function isViewKey(v: string): v is ViewKey {
  return v === "work" || v === "leave" || v === "personal" || v === "team" || v === "admin";
}
```

### 2. time.ts 테스트 먼저 작성 (FAIL 확인)

`tests/modules/calendar/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toKstDateKey,
  kstDayStartUtc,
  allDayHalfOpen,
  normalizeToGridWindow,
  rangesOverlap,
  isAnchorWithinWindow,
} from "@/modules/calendar/time";

describe("toKstDateKey", () => {
  it("KST 자정 경계를 넘은 UTC는 다음 날로 키 매김", () => {
    // 2026-06-18T15:30:00Z = 2026-06-19 00:30 KST
    expect(toKstDateKey(new Date("2026-06-18T15:30:00Z"))).toBe("2026-06-19");
    // 2026-06-18T14:30:00Z = 2026-06-18 23:30 KST
    expect(toKstDateKey(new Date("2026-06-18T14:30:00Z"))).toBe("2026-06-18");
  });
});

describe("kstDayStartUtc", () => {
  it("KST 그 날 00:00의 UTC instant", () => {
    // KST 2026-06-19 00:00 = UTC 2026-06-18T15:00:00Z
    expect(kstDayStartUtc(new Date("2026-06-18T15:30:00Z")).toISOString()).toBe(
      "2026-06-18T15:00:00.000Z",
    );
  });
});

describe("allDayHalfOpen", () => {
  it("동일 KST 일 → [그날 00:00 KST, 다음날 00:00 KST)", () => {
    const r = allDayHalfOpen(new Date("2026-06-19T02:00:00+09:00"), new Date("2026-06-19T20:00:00+09:00"));
    expect(r.start.toISOString()).toBe("2026-06-18T15:00:00.000Z"); // 06-19 00:00 KST
    expect(r.end.toISOString()).toBe("2026-06-19T15:00:00.000Z"); // 06-20 00:00 KST
  });
});

describe("normalizeToGridWindow", () => {
  it("2026-06 → 6주 창(일요일 시작), 길이 42일", () => {
    // 2026-06-01 = 월요일, WEEK_STARTS_ON=0 → 그리드 시작 2026-05-31(일)
    const r = normalizeToGridWindow(new Date("2026-06-15T03:00:00+09:00"));
    expect(r.start.toISOString()).toBe("2026-05-30T15:00:00.000Z"); // 05-31 00:00 KST
    expect(r.end.toISOString()).toBe("2026-07-11T15:00:00.000Z"); // 07-12 00:00 KST
    expect((r.end.getTime() - r.start.getTime()) / 86_400_000).toBe(42);
  });

  it("같은 달의 다른 anchor는 같은 창으로 정규화", () => {
    const a = normalizeToGridWindow(new Date("2026-06-01T00:00:00+09:00"));
    const b = normalizeToGridWindow(new Date("2026-06-30T23:00:00+09:00"));
    expect(a.start.toISOString()).toBe(b.start.toISOString());
    expect(a.end.toISOString()).toBe(b.end.toISOString());
  });
});

describe("rangesOverlap", () => {
  it("반열림 겹침: 접하면 false, 겹치면 true", () => {
    const d = (s: string) => new Date(s);
    expect(rangesOverlap(d("2026-06-01"), d("2026-06-03"), d("2026-06-03"), d("2026-06-05"))).toBe(false);
    expect(rangesOverlap(d("2026-06-01"), d("2026-06-04"), d("2026-06-03"), d("2026-06-05"))).toBe(true);
  });
});

describe("isAnchorWithinWindow", () => {
  const now = new Date("2026-06-15T03:00:00+09:00"); // 2026-06 KST

  it("같은 달·±maxMonths 경계 내 → true", () => {
    expect(isAnchorWithinWindow(new Date("2026-06-01T00:00:00+09:00"), now, 12)).toBe(true);
    expect(isAnchorWithinWindow(new Date("2027-06-15T00:00:00+09:00"), now, 12)).toBe(true); // +12개월 경계
    expect(isAnchorWithinWindow(new Date("2025-06-15T00:00:00+09:00"), now, 12)).toBe(true); // -12개월 경계
  });

  it("창 밖 → false", () => {
    expect(isAnchorWithinWindow(new Date("2027-07-15T00:00:00+09:00"), now, 12)).toBe(false); // +13개월
    expect(isAnchorWithinWindow(new Date("2025-05-15T00:00:00+09:00"), now, 12)).toBe(false); // -13개월
    expect(isAnchorWithinWindow(new Date("1900-01-01T00:00:00+09:00"), now, 12)).toBe(false);
  });
});
```

실행(FAIL 확인): `npm test -- tests/modules/calendar/time.test.ts`

### 3. time.ts 구현 (PASS 확인)

`src/modules/calendar/time.ts`:

```ts
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
```

실행(PASS 확인): `npm test -- tests/modules/calendar/time.test.ts`

### 4. commit

```
git add src/modules/calendar tests/modules/calendar/time.test.ts
git commit -m "calendar: add shared types, constants, view map, KST/grid time utils"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/time.test.ts` → 모든 케이스 PASS.
- `npm run typecheck` → 에러 없음(`@prisma/client` enum import 포함).
- `npm run lint` → calendar 모듈 boundaries 위반 없음(이 태스크는 kernel/lib/타 모듈 import 없음).

## Cautions

- **`Date`를 로컬 타임존 메서드(`getFullYear`/`getMonth`/`getDate`)로 다루지 말 것.** 이유: 테스트·런타임 머신 TZ에 따라 결과가 달라진다. 반드시 `getUTC*` + 명시적 `OFFSET_MS`로만 KST를 계산한다.
- **`shiftToKst`로 만든 Date를 다시 절대시각으로 쓰지 말 것.** 이유: 그것은 "벽시계 표시용" 가짜 instant다. 항상 `- OFFSET_MS`로 되돌린 값만 반환·저장한다.
- **DST 보정 코드 추가 금지.** 이유: KST(Asia/Seoul)는 DST가 없어 고정 +540분이 정확하다. 분기 추가는 불필요한 복잡도다.
