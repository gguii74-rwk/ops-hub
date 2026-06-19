# Task 07 — dedup + masking

두 순수 함수. **dedup**: 외부 휴가성 이벤트를 키워드+all-day로 `EXTERNAL_VACATION`으로 재분류하고, (userId가 매핑된 경우) 내부 APPROVED 휴가와 겹치면 `DUPLICATE_OF_INTERNAL`로 **비파괴 마킹**(삭제 안 함). **masking**: 소유자·권한에 따라 제목/사유를 서버에서 가린다.

## Files

- Create: `src/modules/calendar/dedup/index.ts`
- Create: `src/modules/calendar/masking/index.ts`
- Test: `tests/modules/calendar/dedup.test.ts`
- Test: `tests/modules/calendar/masking.test.ts`

## Prep

- Spec §9(마스킹 정책), §10(중복 제거 비파괴), §11(KST 겹침).
- 엔트리포인트 §Shared Contracts: `RawEvent`, `CalEvent`, `FeedContext`, 상수 `LEAVE_KEYWORDS`, time `rangesOverlap`.

## Deps

01.

## Steps

### 1. dedup 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/dedup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyDedup } from "@/modules/calendar/dedup";
import type { RawEvent } from "@/modules/calendar/types";

function ev(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "EXTERNAL_EVENT", title: "t", description: null,
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: null, sourceKey: "google-team", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, tentative: false, ...p,
  };
}

describe("applyDedup", () => {
  it("외부 all-day + 휴가 키워드 → EXTERNAL_VACATION 재분류", () => {
    const out = applyDedup([ev({ id: "e1", title: "여름 휴가", allDay: true })]);
    expect(out[0].kind).toBe("EXTERNAL_VACATION");
    expect(out[0].dedupStatus).toBe("UNIQUE"); // userId 없으면 dedup은 안 함
  });

  it("키워드 있어도 all-day 아니면 재분류 안 함", () => {
    const out = applyDedup([ev({ id: "e2", title: "휴가 인수인계 회의", allDay: false })]);
    expect(out[0].kind).toBe("EXTERNAL_EVENT");
  });

  it("키워드 없으면 그대로", () => {
    const out = applyDedup([ev({ id: "e3", title: "팀 미팅", allDay: true })]);
    expect(out[0].kind).toBe("EXTERNAL_EVENT");
  });

  it("userId 매핑된 외부 휴가가 내부 APPROVED 휴가와 겹침 → DUPLICATE_OF_INTERNAL(비파괴)", () => {
    const internal = ev({ id: "leave:l1", kind: "INTERNAL_LEAVE", title: "휴가", userId: "u9", sourceKey: "internalLeave", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "google-team:g1", title: "연차", allDay: true, userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([internal, external]);
    expect(out).toHaveLength(2); // 삭제 안 함
    const ext = out.find((e) => e.id === "google-team:g1")!;
    expect(ext.kind).toBe("EXTERNAL_VACATION");
    expect(ext.dedupStatus).toBe("DUPLICATE_OF_INTERNAL");
    expect(ext.duplicateOfId).toBe("leave:l1");
    // 내부 이벤트는 불변
    expect(out.find((e) => e.id === "leave:l1")!.dedupStatus).toBe("UNIQUE");
  });

  it("userId 다르면 dedup 안 함", () => {
    const internal = ev({ id: "leave:l1", kind: "INTERNAL_LEAVE", userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "g1", title: "휴가", allDay: true, userId: "u8", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([internal, external]);
    expect(out.find((e) => e.id === "g1")!.dedupStatus).toBe("UNIQUE");
  });

  it("tentative(PENDING) 내부 휴가는 dedup 앵커가 아님 → 외부 휴가 UNIQUE 유지", () => {
    const pending = ev({ id: "leave:l2", kind: "INTERNAL_LEAVE", title: "휴가", userId: "u9", sourceKey: "internalLeave", tentative: true, start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") });
    const external = ev({ id: "google-team:g2", title: "연차", allDay: true, userId: "u9", start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") });
    const out = applyDedup([pending, external]);
    const extOut = out.find((e) => e.id === "google-team:g2")!;
    expect(extOut.kind).toBe("EXTERNAL_VACATION"); // 키워드 재분류는 됨
    expect(extOut.dedupStatus).toBe("UNIQUE"); // 단 미승인(PENDING)과는 dedup 안 함
  });
});
```

### 2. dedup 구현

`src/modules/calendar/dedup/index.ts`:

```ts
import { LEAVE_KEYWORDS } from "../constants";
import { rangesOverlap } from "../time";
import type { RawEvent } from "../types";

function hasLeaveKeyword(title: string): boolean {
  return LEAVE_KEYWORDS.some((k) => title.includes(k));
}

export function applyDedup(events: RawEvent[]): RawEvent[] {
  // APPROVED 내부 휴가만 권위 앵커. PENDING(tentative)은 확정 전이라 외부 휴가를 접는 근거가 될 수 없다(Finding 3).
  const internalLeaves = events.filter((e) => e.kind === "INTERNAL_LEAVE" && !e.tentative);
  return events.map((e) => {
    if (e.kind !== "EXTERNAL_EVENT" && e.kind !== "EXTERNAL_VACATION") return e;

    const kind = e.kind === "EXTERNAL_EVENT" && e.allDay && hasLeaveKeyword(e.title) ? "EXTERNAL_VACATION" : e.kind;

    if (kind === "EXTERNAL_VACATION" && e.userId) {
      const dup = internalLeaves.find((i) => i.userId === e.userId && rangesOverlap(e.start, e.end, i.start, i.end));
      if (dup) return { ...e, kind, dedupStatus: "DUPLICATE_OF_INTERNAL", duplicateOfId: dup.id };
    }
    return kind === e.kind ? e : { ...e, kind };
  });
}
```

실행: `npm test -- tests/modules/calendar/dedup.test.ts` (FAIL → 구현 후 PASS)

### 3. masking 테스트 먼저 (FAIL 확인)

`tests/modules/calendar/masking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { maskEvent } from "@/modules/calendar/masking";
import type { RawEvent, FeedContext } from "@/modules/calendar/types";

function ev(p: Partial<RawEvent>): RawEvent {
  return {
    id: "x", kind: "INTERNAL_LEAVE", title: "휴가", description: "가족 여행",
    start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z"),
    allDay: true, userId: "u9", sourceKey: "internalLeave", externalId: null,
    dedupStatus: "UNIQUE", duplicateOfId: null, tentative: false, ...p,
  };
}
const ctx = (p: Partial<FeedContext>): FeedContext => ({ userId: "u1", isOwner: false, permissionKeys: new Set<string>(), ...p });

describe("maskEvent", () => {
  it("타인 휴가, 비권한 → 제목 일반화·사유 null·masked true", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1" }));
    expect(c.title).toBe("휴가");
    expect(c.description).toBeNull();
    expect(c.masked).toBe(true);
  });

  it("본인 휴가 → 상세 노출·masked false", () => {
    const c = maskEvent(ev({ userId: "u1", title: "휴가", description: "병원" }), ctx({ userId: "u1" }));
    expect(c.description).toBe("병원");
    expect(c.masked).toBe(false);
  });

  it("calendar.admin:view 보유 → 타인도 상세", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1", permissionKeys: new Set(["calendar.admin:view"]) }));
    expect(c.description).toBe("가족 여행");
    expect(c.masked).toBe(false);
  });

  it("isOwner(시스템 OWNER) → 상세", () => {
    const c = maskEvent(ev({ userId: "u9" }), ctx({ userId: "u1", isOwner: true }));
    expect(c.masked).toBe(false);
  });

  it("공휴일은 민감하지 않음 → 마스킹 안 함", () => {
    const c = maskEvent(ev({ kind: "HOLIDAY", title: "신정", description: null, userId: null }), ctx({ userId: "u1" }));
    expect(c.title).toBe("신정");
    expect(c.masked).toBe(false);
  });

  it("업무 일정도 마스킹 안 함", () => {
    const c = maskEvent(ev({ kind: "WORKFLOW_TASK", title: "주간보고", description: null, userId: null }), ctx({ userId: "u1" }));
    expect(c.masked).toBe(false);
    expect(c.title).toBe("주간보고");
  });

  it("Date는 ISO 문자열로 직렬화", () => {
    const c = maskEvent(ev({}), ctx({ userId: "u1" }));
    expect(c.start).toBe("2026-06-10T00:00:00.000Z");
    expect(c.end).toBe("2026-06-11T00:00:00.000Z");
  });

  it("tentative 플래그는 그대로 통과(가시성/접기 판단은 feed)", () => {
    expect(maskEvent(ev({ tentative: true }), ctx({ userId: "u1" })).tentative).toBe(true);
    expect(maskEvent(ev({ tentative: false }), ctx({ userId: "u1" })).tentative).toBe(false);
  });
});
```

### 4. masking 구현

`src/modules/calendar/masking/index.ts`:

```ts
import type { CalendarEventKind } from "@prisma/client";
import type { CalEvent, FeedContext, RawEvent } from "../types";

const GENERIC_TITLE: Partial<Record<CalendarEventKind, string>> = {
  INTERNAL_LEAVE: "휴가",
  EXTERNAL_VACATION: "휴가",
  PERSONAL_EVENT: "개인 일정",
  EXTERNAL_EVENT: "외부 일정",
};

function isSensitiveKind(kind: CalendarEventKind): boolean {
  return (
    kind === "INTERNAL_LEAVE" ||
    kind === "EXTERNAL_VACATION" ||
    kind === "PERSONAL_EVENT" ||
    kind === "EXTERNAL_EVENT"
  );
}

function canSeeDetail(raw: RawEvent, ctx: FeedContext): boolean {
  if (ctx.isOwner) return true;
  if (raw.userId && raw.userId === ctx.userId) return true;
  if (ctx.permissionKeys.has("calendar.admin:view")) return true;
  return false;
}

export function maskEvent(raw: RawEvent, ctx: FeedContext): CalEvent {
  const masked = isSensitiveKind(raw.kind) && !canSeeDetail(raw, ctx);
  return {
    id: raw.id,
    kind: raw.kind,
    title: masked ? GENERIC_TITLE[raw.kind] ?? "비공개" : raw.title,
    description: masked ? null : raw.description,
    start: raw.start.toISOString(),
    end: raw.end.toISOString(),
    allDay: raw.allDay,
    userId: raw.userId,
    sourceKey: raw.sourceKey,
    dedupStatus: raw.dedupStatus,
    masked,
    tentative: raw.tentative, // 가시성/접기 판단은 feed가 함 — 마스킹은 플래그만 통과
  };
}
```

실행(PASS): `npm test -- tests/modules/calendar/dedup.test.ts tests/modules/calendar/masking.test.ts`

### 5. commit

```
git add src/modules/calendar/dedup src/modules/calendar/masking tests/modules/calendar/dedup.test.ts tests/modules/calendar/masking.test.ts
git commit -m "calendar: add non-destructive dedup + server-side event masking"
```

## Acceptance Criteria

- 두 테스트 파일 PASS.
- `npm run typecheck` / `npm run lint` → OK.

## Cautions

- **dedup에서 이벤트를 배열에서 제거하지 말 것.** 이유: 키워드 휴리스틱은 false positive가 난다(§10). 삭제는 비가역이고 admin 진단을 막는다. 반드시 `dedupStatus` 마킹만. 접기는 feed(Task 08)가 응답 단계에서.
- **마스킹을 클라이언트로 미루지 말 것.** 이유: 마스킹된 응답에 민감정보를 실으면 네트워크에서 유출된다. 반드시 서버에서 title 치환·description null 처리.
- **본인 판정에서 `raw.userId == null`을 본인으로 취급하지 말 것.** 이유: userId 없는 외부/공휴일 이벤트가 "본인 것"으로 새어 상세가 노출된다. 명시적으로 `raw.userId && raw.userId === ctx.userId`.
- **dedup 앵커에 tentative(PENDING) 휴가를 포함하지 말 것.** 이유: 미승인 휴가가 외부 휴가를 접으면, 휴가가 거절돼도 외부 실제 일정이 숨겨진다(Finding 3). 앵커는 `INTERNAL_LEAVE && !tentative`만. tentative 자체의 노출 차단은 feed가 한다(마스킹 아님).
