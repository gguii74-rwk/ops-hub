# Task 08 — feed 합성 서비스

`buildFeed(view, range, ctx, providers)`: view에 맞는 provider를 골라 `Promise.allSettled`로 병렬 호출(부분 실패 허용), dedup 적용, 비-admin 뷰에서 `DUPLICATE_OF_INTERNAL` 접기, 마스킹, `FeedResponse` 조립. provider는 **주입**받으므로 순수 오케스트레이션이라 테스트가 쉽다.

## Files

- Create: `src/modules/calendar/feed/index.ts`
- Test: `tests/modules/calendar/feed.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts: `buildFeed` 시그니처, `VIEW_SOURCES`, `CalendarSourceProvider`, `FeedResponse`, `applyDedup`, `maskEvent`.
- Spec §7(합성 흐름).

## Deps

01, 05, 06(provider 인터페이스 구현체), 07(dedup/masking). buildFeed 자체는 provider를 인자로 받으므로 05/06 구현 없이도 단위 테스트 가능.

## Steps

### 1. 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/feed.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildFeed } from "@/modules/calendar/feed";
import type { CalendarSourceProvider, RawEvent, SourceStatus, FeedContext } from "@/modules/calendar/types";

const range = { start: new Date("2026-05-30T15:00:00Z"), end: new Date("2026-07-11T15:00:00Z") };
const ctx = (p: Partial<FeedContext> = {}): FeedContext => ({ userId: "u1", isOwner: false, permissionKeys: new Set<string>(), ...p });

function raw(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "INTERNAL_LEAVE", title: "휴가", description: "사유",
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: "u9", sourceKey: "internalLeave", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, ...p,
  };
}
const ok = (key: string): SourceStatus => ({ key, state: "ok", lastFetchedAt: null, error: null });

function provider(key: string, events: RawEvent[], statuses: SourceStatus[]): CalendarSourceProvider {
  return { key, fetchEvents: async () => ({ events, statuses }) };
}

describe("buildFeed", () => {
  it("work 뷰: VIEW_SOURCES에 해당하는 provider만 호출하고 병합·마스킹", async () => {
    const providers = {
      workflowTask: provider("workflowTask", [raw({ id: "w1", kind: "WORKFLOW_TASK", title: "주간보고", userId: null, description: null })], [ok("workflowTask")]),
      internalLeave: provider("internalLeave", [raw({ id: "l1", userId: "u9" })], [ok("internalLeave")]),
      holiday: provider("holiday", [raw({ id: "h1", kind: "HOLIDAY", title: "신정", userId: null, description: null })], [ok("holiday")]),
      // google/manual은 work 뷰에 없음 → 호출 안 됨
      google: provider("google", [raw({ id: "should-not-appear" })], [ok("google")]),
    };
    const res = await buildFeed("work", range, ctx({ userId: "u1" }), providers);
    const ids = res.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["w1", "l1", "h1"]));
    expect(ids).not.toContain("should-not-appear");
    // 타인 휴가는 마스킹
    expect(res.events.find((e) => e.id === "l1")!.masked).toBe(true);
    expect(res.events.find((e) => e.id === "l1")!.description).toBeNull();
    expect(res.sources.map((s) => s.key)).toEqual(expect.arrayContaining(["workflowTask", "internalLeave", "holiday"]));
  });

  it("leave 뷰: DUPLICATE_OF_INTERNAL은 접힘(미표시)", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [raw({ id: "leave:l1", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") })], [ok("internalLeave")]),
      google: provider("google", [raw({ id: "google:g1", kind: "EXTERNAL_EVENT", title: "연차", userId: "u9", allDay: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"), sourceKey: "google-team" })], [ok("google-team")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("leave", range, ctx({ userId: "u1", permissionKeys: new Set(["calendar.admin:view"]) }), providers);
    expect(res.events.map((e) => e.id)).toContain("leave:l1");
    expect(res.events.map((e) => e.id)).not.toContain("google:g1"); // 접힘
  });

  it("admin 뷰: DUPLICATE_OF_INTERNAL도 표시", async () => {
    const providers = {
      internalLeave: provider("internalLeave", [raw({ id: "leave:l1", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") })], [ok("internalLeave")]),
      workflowTask: provider("workflowTask", [], [ok("workflowTask")]),
      manual: provider("manual", [], [ok("manual")]),
      google: provider("google", [raw({ id: "google:g1", kind: "EXTERNAL_EVENT", title: "연차", userId: "u9", allDay: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"), sourceKey: "google-team" })], [ok("google-team")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("admin", range, ctx({ userId: "u1", isOwner: true }), providers);
    expect(res.events.map((e) => e.id)).toContain("google:g1");
    expect(res.events.find((e) => e.id === "google:g1")!.dedupStatus).toBe("DUPLICATE_OF_INTERNAL");
  });

  it("stale/failed status 집계 + 원본 에러 sanitize(서버 로그만)", async () => {
    const providers = {
      workflowTask: provider("workflowTask", [], [ok("workflowTask")]),
      internalLeave: provider("internalLeave", [], [{ key: "internalLeave", state: "failed", lastFetchedAt: null, error: "ECONNREFUSED 10.0.0.5:5432" }]),
      holiday: provider("holiday", [], [{ key: "holiday-kr", state: "stale", lastFetchedAt: "2026-06-18T00:00:00.000Z", error: "google 500" }]),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await buildFeed("work", range, ctx(), providers);
    expect(res.failedSources).toEqual(["internalLeave"]);
    expect(res.staleSources).toEqual(["holiday-kr"]);
    // 클라이언트向 메시지는 일반화, 원본(DB 주소 등)은 노출 안 함
    const failed = res.sources.find((s) => s.key === "internalLeave")!;
    expect(failed.error).toBe("일정을 불러오지 못했습니다.");
    expect(failed.error).not.toContain("ECONNREFUSED");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("provider가 reject해도 전체는 죽지 않고 failed로 환원", async () => {
    const providers = {
      workflowTask: { key: "workflowTask", fetchEvents: async () => { throw new Error("boom"); } } as CalendarSourceProvider,
      internalLeave: provider("internalLeave", [raw({ id: "l1", userId: "u1" })], [ok("internalLeave")]),
      holiday: provider("holiday", [], [ok("holiday-kr")]),
    };
    const res = await buildFeed("work", range, ctx({ userId: "u1" }), providers);
    expect(res.failedSources).toContain("workflowTask");
    expect(res.events.map((e) => e.id)).toContain("l1");
  });
});
```

실행(FAIL): `npm test -- tests/modules/calendar/feed.test.ts`

### 2. 구현 (PASS 확인)

`src/modules/calendar/feed/index.ts`:

```ts
import type { CalendarSourceProvider, CalEvent, FeedContext, FeedResponse, NormalizedRange, RawEvent, SourceStatus, ViewKey } from "../types";
import { VIEW_SOURCES } from "../views";
import { applyDedup } from "../dedup";
import { maskEvent } from "../masking";

export async function buildFeed(
  view: ViewKey,
  range: NormalizedRange,
  ctx: FeedContext,
  providers: Record<string, CalendarSourceProvider>,
): Promise<FeedResponse> {
  const selected = VIEW_SOURCES[view]
    .map((key) => providers[key])
    .filter((p): p is CalendarSourceProvider => Boolean(p));

  const settled = await Promise.allSettled(selected.map((p) => p.fetchEvents(range, ctx)));

  const raw: RawEvent[] = [];
  const statuses: SourceStatus[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      raw.push(...r.value.events);
      statuses.push(...r.value.statuses);
    } else {
      statuses.push({
        key: selected[i].key,
        state: "failed",
        lastFetchedAt: null,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  const deduped = applyDedup(raw);
  // 비-admin 뷰는 내부 휴가와 중복인 외부 이벤트를 접는다(비파괴 — 원본은 admin 뷰에서 노출).
  const visible = view === "admin" ? deduped : deduped.filter((e) => e.dedupStatus !== "DUPLICATE_OF_INTERNAL");
  const events: CalEvent[] = visible.map((e) => maskEvent(e, ctx));

  // 클라이언트向 출처 오류는 일반 메시지로만 — 원본 예외는 서버 로그에만(민감정보 유출 방지, 적대적 리뷰 #7).
  const sources: SourceStatus[] = statuses.map((s) => {
    if (s.state === "ok") return s;
    if (s.error) console.error(`[calendar] source ${s.key} ${s.state}:`, s.error);
    return { ...s, error: s.state === "failed" ? "일정을 불러오지 못했습니다." : "최신 동기화에 실패해 이전 데이터를 표시합니다." };
  });
  const staleSources = sources.filter((s) => s.state === "stale").map((s) => s.key);
  const failedSources = sources.filter((s) => s.state === "failed").map((s) => s.key);

  return { events, sources, staleSources, failedSources };
}
```

실행(PASS): `npm test -- tests/modules/calendar/feed.test.ts`

### 3. commit

```
git add src/modules/calendar/feed tests/modules/calendar/feed.test.ts
git commit -m "calendar: add feed orchestration (allSettled, dedup fold, masking)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/feed.test.ts` → PASS.
- `npm run typecheck` / `npm run lint` → OK.

## Cautions

- **`Promise.all`로 바꾸지 말 것.** 이유: 한 출처 실패가 전체를 reject시켜 부분 실패 허용(§7)이 깨진다. 반드시 `allSettled`.
- **admin 외 뷰에서 DUPLICATE_OF_INTERNAL을 배열에서 영구 제거하지 말 것.** 이유: 같은 raw 배열을 admin 경로가 재사용할 수 있어야 한다. 접기는 뷰별 `filter`로만(비파괴).
- **provider 선택을 하드코딩하지 말 것.** 이유: view↔sources 매핑의 단일 출처는 `VIEW_SOURCES`다(엔트리포인트). 여기서 재정의하면 드리프트.
