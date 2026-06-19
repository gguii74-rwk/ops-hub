# Phase 3 — 통합 캘린더와 캐시 (구현 계획 엔트리포인트)

- Spec: `docs/specs/2026-06-19-phase-3-calendar-design.md`
- Goal: view·기간·권한에 따라 다른 응답을 만드는 단일 feed API와, 외부(Google·공휴일) 캐시 + 내부(휴가·업무) 직접 조회를 합성하는 캘린더 도메인을 구축한다.
- Architecture: `src/modules/calendar`에 합성 엔진(types·repository·cache·sources·dedup·masking·feed)을 두고, Google 클라이언트는 `src/lib/integrations/google`(lib)에 둔다. 내부 출처는 calendar-owned repository가 `@/lib/prisma`로 직접 조회, 외부는 `CalendarCacheEntry` cache-first(만료 시 인라인 재검증). API는 `GET /api/calendar/feed` + `POST /api/calendar/refresh`. UI는 React Query 기반 커스텀 월 그리드(work/leave/personal 3뷰).
- Tech Stack: Next.js App Router, Prisma, `googleapis`(기설치), `@tanstack/react-query`(신규), vitest(node), Tailwind v4 + 기존 ui 프리미티브.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-19-phase-3-calendar/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

이 절은 2개 이상 태스크가 참조하는 타입·시그니처·상수의 단일 출처다. 태스크 파일은 공유 타입을 재인라인하지 않고 "엔트리포인트 §Shared Contracts"를 가리킨다.

### 상수 (`src/modules/calendar/constants.ts`)

```ts
export const KST_OFFSET_MIN = 540;              // UTC+9, DST 없음
export const WEEK_STARTS_ON = 0;                // 0=일요일. 월 그리드 주 시작의 단일 출처
export const DEFAULT_GOOGLE_TTL_SEC = 900;      // CalendarSource.cacheTtlSeconds 기본
export const HOLIDAY_TTL_SEC = 86_400;          // 공휴일 24h
export const MIN_REFRESH_INTERVAL_SEC = 30;     // 강제 새로고침 해머링 차단(§12.4)
export const LEAVE_KEYWORDS = ["휴가", "연차", "반차", "오전반차", "오후반차"] as const;
```

### 공통 타입 (`src/modules/calendar/types.ts`)

`CalendarEventKind`, `CalendarDedupStatus`는 `@prisma/client` enum을 재사용한다.

```ts
import type { CalendarEventKind, CalendarDedupStatus } from "@prisma/client";

export type ViewKey = "work" | "leave" | "personal" | "team" | "admin";

// 반열림 [start, end). Date는 절대시각(UTC instant)이며, 경계는 KST 기준으로 계산된다.
export interface NormalizedRange { start: Date; end: Date; }

// 마스킹·dedup 이전 원본 이벤트
export interface RawEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: Date;
  end: Date;                 // 반열림 종료
  allDay: boolean;
  userId: string | null;     // 이벤트 소유자(있으면)
  sourceKey: string;         // 출처 식별(UI 색/그룹, 상태 매칭)
  externalId: string | null;
  dedupStatus: CalendarDedupStatus;
  duplicateOfId: string | null;
  tentative: boolean;        // 미승인(PENDING) 휴가 등 잠정 일정. 본인·admin만 노출, dedup 앵커 제외(§10).
}

// 마스킹 끝난 직렬화 형태(클라이언트로 나가는 형태)
export interface CalEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: string;             // ISO
  end: string;               // ISO
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
  dedupStatus: CalendarDedupStatus;
  masked: boolean;
  tentative: boolean;        // 잠정(미승인) 일정 — UI가 별도 스타일로 표시
}

export interface SourceStatus {
  key: string;
  state: "ok" | "stale" | "failed";
  lastFetchedAt: string | null;   // 외부 출처만 채움
  error: string | null;           // 운영자용(민감정보 제외)
}

export interface FeedResponse {
  events: CalEvent[];
  sources: SourceStatus[];
  staleSources: string[];
  failedSources: string[];
}

// 권한 평가에 필요한 호출자 맥락
export interface FeedContext {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;    // getPermissionSummary().keys → Set
}

// 한 provider 호출 결과(google처럼 내부에 N개 캘린더가 있으면 statuses가 여러 개)
export interface SourceResult {
  events: RawEvent[];
  statuses: SourceStatus[];
}

export interface CalendarSourceProvider {
  key: string;
  fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<SourceResult>;
}
```

### view → permission / sources (`src/modules/calendar/views.ts`)

```ts
import type { ViewKey } from "./types";

export const VIEW_PERMISSION: Record<ViewKey, string> = {
  work: "calendar.work",
  leave: "calendar.leave",
  personal: "calendar.personal",
  team: "calendar.team",
  admin: "calendar.admin",
};

// Phase 3 UI가 노출하는 뷰(§8.1: 실제 노출은 권한 있는 탭만)
export const UI_VIEWS: ViewKey[] = ["work", "leave", "personal"];

// 각 view에 합성할 provider key 집합
export const VIEW_SOURCES: Record<ViewKey, string[]> = {
  work: ["workflowTask", "internalLeave", "holiday"],
  leave: ["internalLeave", "google", "holiday"],
  personal: ["internalLeave", "manual", "google", "holiday"], // workflowTask 제외(사용자 귀속 없는 조직 일정). feed가 본인 소유+공휴일만 통과(§9 personal 스코프)
  team: ["workflowTask", "internalLeave", "holiday"],
  admin: ["internalLeave", "workflowTask", "manual", "google", "holiday"],
};
```

### 시간/범위 유틸 시그니처 (`src/modules/calendar/time.ts`) — Task 01

```ts
export function toKstDateKey(d: Date): string;                    // 'YYYY-MM-DD' (KST)
export function kstDayStartUtc(d: Date): Date;                    // 그 날 00:00 KST의 UTC instant
export function allDayHalfOpen(startInclusive: Date, endInclusive: Date): { start: Date; end: Date };
export function normalizeToGridWindow(anchor: Date): NormalizedRange;  // anchor가 속한 달의 6주 그리드 창
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean; // 반열림
```

### repository 시그니처 (`src/modules/calendar/repositories/index.ts`) — Task 02

```ts
import type { LeaveRequestStatus } from "@prisma/client";
export interface LeaveRow { id: string; userId: string; leaveType: string; reason: string | null; startDate: Date; endDate: Date; status: LeaveRequestStatus; }
export interface WorkflowRow { id: string; title: string; scheduledAt: Date; status: string; }
export interface ManualRow { id: string; kind: "PERSONAL_EVENT" | "TEAM_EVENT"; title: string; description: string | null; startsAt: Date; endsAt: Date; allDay: boolean; userId: string | null; sourceKey: string; }
export interface SourceRow { id: string; key: string; externalId: string | null; name: string; cacheTtlSeconds: number; ownerUserId: string | null; }
export interface CacheRow { payload: unknown; fetchedAt: Date; expiresAt: Date; errorMessage: string | null; }

export function findLeaveInRange(range: NormalizedRange, statuses: LeaveRequestStatus[]): Promise<LeaveRow[]>;
export function findWorkflowTasksInRange(range: NormalizedRange): Promise<WorkflowRow[]>;
export function findManualEventsInRange(range: NormalizedRange, viewer: { userId: string; includeAllPersonal: boolean }): Promise<ManualRow[]>; // PERSONAL은 viewer 본인만(includeAllPersonal=admin이면 전체), TEAM은 전체
export function findSourcesByKind(kinds: Array<"GOOGLE_CALENDAR" | "HOLIDAY">): Promise<SourceRow[]>;
export function readCacheEntry(sourceId: string, range: NormalizedRange): Promise<CacheRow | null>;
export function writeCacheEntry(sourceId: string, range: NormalizedRange, payload: unknown, expiresAt: Date, errorMessage: string | null): Promise<void>;
```

### cache 시그니처 (`src/modules/calendar/cache/index.ts`) — Task 03

```ts
export interface CacheOutcome<T> { data: T | null; state: "ok" | "stale" | "failed"; fetchedAt: Date | null; error: string | null; }
// expired면 fetcher 호출(인라인 재검증). 실패 시 last-good 있으면 stale, 없으면 failed.
// 실패(warm/cold 모두)는 짧은 backoff(MIN_REFRESH_INTERVAL)를 expiresAt에 기록 → 장애 지속 시 매 요청 재fetch 방지. forceRefresh도 min-interval 가드.
export function getCachedPayload<T>(args: {
  source: { id: string; cacheTtlSeconds: number };
  range: NormalizedRange;
  fetcher: () => Promise<T>;
  now?: () => Date;
  forceRefresh?: boolean;
}): Promise<CacheOutcome<T>>;
```

### dedup / masking / feed 시그니처 — Task 07/08

```ts
// dedup: 외부 휴가성 이벤트를 내부 APPROVED(=非tentative) 휴가와 겹치면 DUPLICATE_OF_INTERNAL로 마킹(비파괴). PENDING 휴가는 앵커가 아니다.
export function applyDedup(events: RawEvent[]): RawEvent[];                       // src/modules/calendar/dedup/index.ts
// masking: 권한·소유자에 따라 제목/사유 마스킹. 본인 이벤트는 항상 상세. tentative 플래그는 그대로 통과(가시성 판단은 feed). (view는 마스킹과 무관)
export function maskEvent(raw: RawEvent, ctx: FeedContext): CalEvent; // src/modules/calendar/masking/index.ts
// feed: provider 선택 → allSettled → dedup → 기본 뷰는 DUPLICATE_OF_INTERNAL 접기 → tentative 가시성 필터(본인/admin만) → personal 뷰 본인 소유+공휴일 한정 → mask → 조립
export function buildFeed(view: ViewKey, range: NormalizedRange, ctx: FeedContext, providers: Record<string, CalendarSourceProvider>): Promise<FeedResponse>; // src/modules/calendar/feed/index.ts
```

### Google 클라이언트 시그니처 (`src/lib/integrations/google/`) — Task 04

boundaries상 **lib는 module 타입(`RawEvent`)을 import할 수 없다.** 따라서 lib는 lib-local `NormalizedGoogleEvent`까지만 만들고, `RawEvent` 변환은 module의 google provider(Task 06)가 한다.

```ts
// map.ts (순수, 테스트 대상)
export interface GoogleRawEvent { id: string; summary: string | null; description: string | null; start: { date?: string; dateTime?: string } | null; end: { date?: string; dateTime?: string } | null; }
export interface NormalizedGoogleEvent { id: string; summary: string | null; description: string | null; start: Date; end: Date; allDay: boolean; }
export function normalizeGoogleEvent(ev: GoogleRawEvent): NormalizedGoogleEvent;
// calendar.ts (service account client)
export interface GoogleCalendarClient { listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<NormalizedGoogleEvent[]>; }
export function getGoogleCalendarClient(): GoogleCalendarClient;     // GOOGLE_APPLICATION_CREDENTIALS
```

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 공통 타입·상수·KST/range 유틸 | [ ] | [task-01](2026-06-19-phase-3-calendar/task-01-types-time.md) | — | |
| 02 | calendar repository (Prisma 직접 조회) | [ ] | [task-02](2026-06-19-phase-3-calendar/task-02-repository.md) | 01 | |
| 03 | cache 레이어 (TTL·인라인 재검증) | [ ] | [task-03](2026-06-19-phase-3-calendar/task-03-cache.md) | 01,02 | |
| 04 | Google 클라이언트 (lib) + 매핑 | [ ] | [task-04](2026-06-19-phase-3-calendar/task-04-google-client.md) | 01 | |
| 05 | 내부 provider (leave·workflow·manual) | [ ] | [task-05](2026-06-19-phase-3-calendar/task-05-internal-providers.md) | 01,02 | |
| 06 | 외부 provider (google·holiday) + 캐시 | [ ] | [task-06](2026-06-19-phase-3-calendar/task-06-external-providers.md) | 01,02,03,04 | |
| 07 | dedup + masking | [ ] | [task-07](2026-06-19-phase-3-calendar/task-07-dedup-masking.md) | 01 | |
| 08 | feed 합성 서비스 | [ ] | [task-08](2026-06-19-phase-3-calendar/task-08-feed-service.md) | 01,05,06,07 | |
| 09 | API: GET feed + POST refresh | [ ] | [task-09](2026-06-19-phase-3-calendar/task-09-api-routes.md) | 08 | |
| 10 | seed: CalendarSource + 외주 권한 보정 | [ ] | [task-10](2026-06-19-phase-3-calendar/task-10-seed.md) | 01 | |
| 11 | UI: React Query + 월 그리드 3뷰 | [ ] | [task-11](2026-06-19-phase-3-calendar/task-11-ui.md) | 01,09 | |

## 공통 규칙

- TDD: 실패 테스트 → FAIL 확인 → 최소 구현 → PASS → commit. 태스크마다.
- 테스트는 node 환경(DB·외부 없이). Prisma는 `vi.mock("@/lib/prisma", …)` in-memory fake, 외부는 fake client 주입.
- boundaries: `calendar` 모듈은 kernel·lib·자기 모듈만 import(타 모듈 금지). Prisma는 calendar repository에서만.
- 게이트: 각 태스크 AC에 `npm run typecheck` / `npm run lint` / `npm test` 포함. 스키마 변경 없음(인덱스 추가 필요 시에만 migration).
- AI 서명 없는 commit(글로벌 규칙).
