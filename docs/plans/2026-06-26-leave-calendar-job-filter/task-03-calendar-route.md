# Task 03 — API 라우트(윈도우 검증·job 파싱·`{events,holidays,unsyncedYears}`·D9 불변식·read-only)

**목적:** `GET /api/leave/calendar`를 확장한다 — (a) 윈도우 입력 검증(D10), (b) `job` 화이트리스트 파싱→서비스 전달(D7), (c) 공휴일을 **read-only로** 읽어(D8) 응답을 `{ events, holidays, unsyncedYears }`로 확장(D6/D9), (d) 공휴일 조회/probe 실패를 깨끗한 빈 상태로 둔갑시키지 않는 불변식(D9).

## Files

- Modify: `src/app/api/leave/calendar/route.ts`
- Test: `tests/app/api/leave/calendar-route.test.ts`

## Prep

- spec §3.3 / §5 / D8·D9·D10 읽기. 엔트리포인트 §Shared Contracts **S1·S2·S4·S5** 사용.
- 기존 라우트(auth → try → `requirePermission` → 날짜 파싱 → `getPermissionSummary` → `getLeaveCalendar` → `{ events }`)를 보존하고 확장한다.
- `parseLeaveDate`는 형식 위반 시 `LeaveValidationError`를 던진다(→ `mapError`가 400). 윈도우 위반도 같은 에러로 통일한다.

## Deps

- task-01(`getHolidayEventsInRange`), task-02(`getLeaveCalendar`의 `job` 파라미터).

## TDD steps

### Step 1 — 실패 테스트 추가(라우트 테스트 확장)

`tests/app/api/leave/calendar-route.test.ts`를 수정한다.

(a) hoisted 블록에 공휴일 mock을 추가한다(기존 `h` 객체 확장):

```ts
const h = vi.hoisted(() => {
  class FakeForbidden extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return {
    auth: vi.fn(async () => ({ user: { id: "u1", systemRole: "MEMBER" } } as any)),
    requirePermission: vi.fn(async () => undefined),
    getPermissionSummary: vi.fn(async () => ({ keys: [] as string[] })),
    getLeaveCalendar: vi.fn(async () => []),
    getHolidayEventsInRange: vi.fn(async () => [] as { date: string; name: string }[]),
    getUnsyncedYears: vi.fn(async () => [] as number[]),
    FakeForbidden,
  };
});
```

(b) `@/kernel/holidays` mock을 추가한다(기존 mock들 아래):

```ts
vi.mock("@/kernel/holidays", () => ({
  getHolidayEventsInRange: (...a: unknown[]) => (h.getHolidayEventsInRange as (...args: unknown[]) => unknown)(...a),
  getUnsyncedYears: (...a: unknown[]) => (h.getUnsyncedYears as (...args: unknown[]) => unknown)(...a),
}));
```

(c) `beforeEach`에 공휴일 mock 기본값 리셋을 추가한다:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.getPermissionSummary.mockResolvedValue({ keys: [] });
  h.getLeaveCalendar.mockResolvedValue([]);
  h.getHolidayEventsInRange.mockResolvedValue([]);
  h.getUnsyncedYears.mockResolvedValue([]);
});
```

(d) 시간 의존을 피하기 위해 **now 기준 상대 날짜 헬퍼**를 import 아래에 추가한다(라우트가 실제 `new Date()`로 운영 창을 검증하므로 하드코딩 연도는 12개월 경과 시 깨진다):

```ts
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function yearsSpanned(startKey: string, endKey: string): number[] {
  const ys: number[] = [];
  for (let y = Number(startKey.slice(0, 4)); y <= Number(endKey.slice(0, 4)); y++) ys.push(y);
  return ys;
}
```

(e) 기존 "happy-path 200 + events 배열" 케이스를 응답 확장 단언으로 갱신하고, 새 케이스를 추가한다:

```ts
  // read-only(D8) 증명: 아래 @/kernel/holidays mock은 getHolidayEventsInRange/getUnsyncedYears만 노출한다.
  // 라우트가 ensureYearsSynced/syncHolidaysForYear를 호출하면 "is not a function"으로 크래시 → 이 happy-path가 그 부재를 보증.
  it("happy-path 200 + {events,holidays,unsyncedYears}(동기화 미호출=read-only)", async () => {
    h.getHolidayEventsInRange.mockResolvedValueOnce([{ date: daysFromNow(5), name: "테스트공휴일" }]);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.holidays)).toBe(true);
    expect(body.holidays).toHaveLength(1);
    expect(Array.isArray(body.unsyncedYears)).toBe(true);
    expect(h.requirePermission).toHaveBeenCalledWith("u1", "leave.request", "view");
  });

  it("미적재 연도는 unsyncedYears에 담김(getUnsyncedYears 결과 그대로)", async () => {
    const start = daysFromNow(0);
    const want = [Number(start.slice(0, 4))];
    h.getUnsyncedYears.mockResolvedValueOnce(want);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${daysFromNow(20)}`));
    const body = await res.json();
    expect(body.unsyncedYears).toEqual(want);
  });

  // D10 윈도우 검증
  it("end < start → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(10)}&end=${daysFromNow(0)}`));
    expect(res.status).toBe(400);
  });
  it("일수 상한 초과(>46일) → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(89)}`));
    expect(res.status).toBe(400);
  });
  it("운영 창(now±MAX_ANCHOR_MONTHS) 밖 → 400", async () => {
    // 2000년은 어떤 현실적 실행 시각에서도 ±12개월 밖(하드코딩 안전).
    const res = await GET(new Request("http://x/api/leave/calendar?start=2000-01-01&end=2000-01-31"));
    expect(res.status).toBe(400);
  });

  // D7 job 검증
  it("job 화이트리스트 값은 서비스에 전달", async () => {
    await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=DEVELOPER`));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(expect.objectContaining({ job: "DEVELOPER" }));
  });
  it("job=ALL/없음은 무필터(null) 전달", async () => {
    await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=ALL`));
    expect(h.getLeaveCalendar).toHaveBeenCalledWith(expect.objectContaining({ job: null }));
  });
  it("job 화이트리스트 외 값 → 400", async () => {
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${daysFromNow(0)}&end=${daysFromNow(20)}&job=PM`));
    expect(res.status).toBe(400);
  });

  // D9 불변식: 공휴일 조회 실패가 깨끗한 빈 상태로 둔갑하지 않음 — 윈도우 전체 연도를 신호
  it("getHolidayEventsInRange throw 시 holidays:[] + unsyncedYears=윈도우 전체 연도", async () => {
    h.getHolidayEventsInRange.mockRejectedValueOnce(new Error("db down"));
    const start = daysFromNow(0);
    const end = daysFromNow(20);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${end}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holidays).toEqual([]);
    expect(body.unsyncedYears).toEqual(yearsSpanned(start, end)); // 보수적: 윈도우 전체 연도
  });
  it("getUnsyncedYears throw 시에도 동일 degraded 신호", async () => {
    h.getUnsyncedYears.mockRejectedValueOnce(new Error("count fail"));
    const start = daysFromNow(0);
    const end = daysFromNow(20);
    const res = await GET(new Request(`http://x/api/leave/calendar?start=${start}&end=${end}`));
    const body = await res.json();
    expect(body.holidays).toEqual([]);
    expect(body.unsyncedYears).toEqual(yearsSpanned(start, end));
  });
```

> 기존 케이스(미인증 401 / 권한 없음 403 / 일반·status·admin 플래그)는 그대로 둔다. 단, 그 케이스들은 start/end 없이 호출하므로 기본 윈도우(당월)가 운영 창·일수 상한을 자동으로 만족한다 — 회귀 없음.

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/app/api/leave/calendar-route.test.ts
```

기대: 응답 형태·윈도우 검증·job 파싱·D9 신규 케이스 FAIL.

### Step 3 — 구현

`src/app/api/leave/calendar/route.ts` **전체 교체**:

```ts
import { NextResponse } from "next/server";
import type { JobFunction } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requirePermission, getPermissionSummary } from "@/kernel/access";
import { getLeaveCalendar } from "@/modules/leave/services/calendar";
import { getHolidayEventsInRange, getUnsyncedYears } from "@/kernel/holidays";
import { parseLeaveDate } from "@/modules/leave/rules";
import { LeaveValidationError } from "@/modules/leave/errors";
import { isAnchorWithinWindow } from "@/modules/calendar/time";
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants";
import { mapError } from "@/app/api/leave/_shared";

const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_DAYS = 46; // 월 그리드 한 화면(≤6주) — feed normalizeToGridWindow와 동일 폭(D10)
const JOB_FILTERS: JobFunction[] = ["DEVELOPER", "CIVIL_RESPONSE", "CONTENT_MANAGER"]; // PM 제외(D2)

// 쿼리 job → JobFunction|null(무필터). 화이트리스트 외 값은 400(LeaveValidationError).
function parseJob(raw: string | null): JobFunction | null {
  if (!raw || raw === "ALL") return null;
  if ((JOB_FILTERS as string[]).includes(raw)) return raw as JobFunction;
  throw new LeaveValidationError(`직무 값이 올바르지 않습니다: ${raw}`);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  try {
    await requirePermission(session.user.id, "leave.request", "view");
    const now = new Date();
    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    const start = startStr
      ? parseLeaveDate(startStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = endStr
      ? parseLeaveDate(endStr)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

    // 윈도우 입력 검증(D10): ① start≤end ② 일수 상한(≤46일) ③ 양 끝 운영 창(now±MAX_ANCHOR_MONTHS). 위반 시 400.
    if (start.getTime() > end.getTime())
      throw new LeaveValidationError("시작일은 종료일보다 이전이어야 합니다.");
    if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * MS_PER_DAY)
      throw new LeaveValidationError("조회 범위가 너무 넓습니다.");
    if (!isAnchorWithinWindow(start, now, MAX_ANCHOR_MONTHS) || !isAnchorWithinWindow(end, now, MAX_ANCHOR_MONTHS))
      throw new LeaveValidationError("조회 범위가 허용 창을 벗어났습니다.");

    const job = parseJob(url.searchParams.get("job"));

    const keys = new Set((await getPermissionSummary(session.user.id)).keys);
    // admin:view만 전 상태·마스킹 해제. status:view는 팀 경계만 넘되 APPROVED-only·마스킹(사유 보호).
    const canViewAllStatuses = keys.has("leave.admin:view");
    const canCrossTeam = canViewAllStatuses || keys.has("leave.status:view");
    const events = await getLeaveCalendar({
      viewerId: session.user.id,
      canViewAllStatuses,
      canCrossTeam,
      start,
      end,
      filterTeamId: canCrossTeam ? url.searchParams.get("teamId") : null,
      job,
    });

    // 조회 윈도우가 걸친 연도(D10으로 ≤2). 공휴일은 read-only(D8) — 동기화 호출 없음.
    const years: number[] = [];
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) years.push(y);
    let holidays: { date: string; name: string }[] = [];
    let unsyncedYears: number[];
    try {
      holidays = await getHolidayEventsInRange(start, end);
      unsyncedYears = await getUnsyncedYears(years);
    } catch (e) {
      // D9 불변식(F3): 미적재·실패를 깨끗한 빈 상태로 둔갑시키지 않는다 — 윈도우 전체 연도를 보수적 degraded 신호로.
      console.error("[leave/calendar] 공휴일 조회 실패(degraded):", e);
      holidays = [];
      unsyncedYears = years;
    }

    return NextResponse.json({ events, holidays, unsyncedYears }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
```

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/app/api/leave/calendar-route.test.ts
```

기대: 신규+기존 전부 PASS.

### Step 5 — 커밋

```bash
git add src/app/api/leave/calendar/route.ts tests/app/api/leave/calendar-route.test.ts
git commit -m "feat(leave): 캘린더 라우트 윈도우 검증·직무 파싱·공휴일 read-only 응답(events/holidays/unsyncedYears)"
```

## Acceptance Criteria

- `npm test -- tests/app/api/leave/calendar-route.test.ts` → 신규+기존 전부 green.
- `npm run typecheck` / `npm run lint` → 통과.
- 응답이 `{ events, holidays, unsyncedYears }`. 라우트가 `ensureYearsSynced`/`syncHolidaysForYear`를 import·호출하지 않음(D8).
- 윈도우 위반·job 화이트리스트 외 → 400. 공휴일 조회/probe throw → `holidays:[]` + `unsyncedYears`=윈도우 전체 연도(D9 불변식).

## Cautions

- **Don't 공휴일 조회 실패를 outer `catch(mapError)`로 흘려보내지 마라.** 이유: 공휴일 실패는 화면을 막지 않고 degraded 신호여야 한다(D9). 휴가 조회 실패만 에러로 전파.
- **Don't read 경로에서 `ensureYearsSynced`/`syncHolidaysForYear`를 호출하지 마라.** 이유: D8 read-only — 키 부재·외부 장애 시 평범한 조회가 블로킹되고 미적재 연도를 매 로드마다 재시도하게 된다. 채우기는 부팅/신청 백스톱/admin 동기화에 맡긴다.
- **Don't 윈도우 위반을 무시하거나 silently clamp 하지 마라.** 이유: enumeration·쿼리 폭주 하드닝(F7/F10) — 위반은 400으로 거부.
- **Don't `requirePermission` 순서를 바꾸지 마라.** 이유: 인증·인가 후에 파라미터 처리(기존 순서 유지).
