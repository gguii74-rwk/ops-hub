# Task 02 — 서비스 직무 필터(`job` 교집합, jobFunction 미노출)

**목적:** `getLeaveCalendar`에 `job?: JobFunction | null`을 추가한다. `job`이 주어지면 그 `jobFunction`의 ACTIVE userId 집합을 조회해 기존 권한 스코프 `where`에 **AND 교집합**한다. 응답/`LeaveCalendarEvent`에 `jobFunction`을 추가하지 않는다(D7, 데이터 최소화).

## Files

- Modify: `src/modules/leave/services/calendar.ts`
- Test: `tests/modules/leave/calendar-service.test.ts` — describe 블록 추가

## Prep

- spec §3.2 / §4 읽기. 엔트리포인트 §Shared Contracts **S1**, **S3** 사용.
- 기존 구현(3 분기: admin / status:view(cross-team) / 일반(self))과 `rangeAnd`(line 27) 구조를 그대로 유지하고, **직무 제약을 AND 배열에 추가**하는 방식으로 모든 분기에 균일 적용한다(top-level `userId` 키 충돌 회피).

## Deps

없음(서비스 독립). 라우트(task-03)가 이 파라미터를 소비.

## TDD steps

### Step 1 — 실패 테스트 추가

`tests/modules/leave/calendar-service.test.ts` 파일 끝에 describe 블록을 추가한다.

> 호출 순서 주의: 직무 user 조회(`prisma.user.findMany`)는 **분기 로직보다 먼저** 실행된다. 따라서 일반 사용자(self) + job 케이스의 `prisma.user.findMany` 호출 순서는 **① 직무 userId → ② 팀 others → ③ 이름**이다. status/admin 분기엔 `findUnique`가 없어 직무 userId가 첫 `findMany`다.

```ts
import type { JobFunction } from "@prisma/client";

describe("getLeaveCalendar — 직무 필터(job, 서버 교집합·jobFunction 미노출)", () => {
  it("admin + job: jobFunction ACTIVE userId 집합을 AND로 교집합(rangeAnd에 추가)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }, { id: "dev2" }] as never); // 직무 userId
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "DEVELOPER" as JobFunction, ...range });
    expect(vi.mocked(prisma.user.findMany)).toHaveBeenNthCalledWith(1, {
      where: { jobFunction: "DEVELOPER", status: "ACTIVE" },
      select: { id: true },
    });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: ["dev1", "dev2"] } }]));
  });

  it("빈 직무 집합이면 AND에 {userId:{in:[]}} — 빈 결과", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // 직무 userId 없음
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "CONTENT_MANAGER" as JobFunction, ...range });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: [] } }]));
  });

  it("job 없음(미지정)이면 직무 user 조회 안 함 + AND에 직무 제약 없음", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never); // names only
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, ...range });
    const where = getFirstCallWhere();
    // AND엔 rangeAnd(2건)만 — 직무 제약 미포함
    expect((where.AND as unknown[]).some((c) => JSON.stringify(c).includes("userId"))).toBe(false);
  });

  it("일반(self) + job: 직무 user 조회가 먼저, 그 다음 팀 조회(findUnique)·이름", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }] as never); // ① 직무 userId
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: "team1" } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u2" }] as never); // ② 팀 others
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as never); // ③ names
    await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: false, canCrossTeam: false, job: "DEVELOPER" as JobFunction, ...range });
    const where = getFirstCallWhere();
    expect(where.AND).toEqual(expect.arrayContaining([{ userId: { in: ["dev1"] } }]));
    expect(where.OR).toEqual(expect.arrayContaining([{ userId: "u1" }])); // self OR 유지
  });

  it("반환 이벤트에 jobFunction 필드가 없다(D7)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1" }] as never); // 직무 userId
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r1", userId: "dev1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null, startDate: range.start, endDate: range.start, status: "APPROVED", reason: null },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "dev1", name: "김" }] as never); // names
    const ev = await getLeaveCalendar({ viewerId: "u1", canViewAllStatuses: true, canCrossTeam: true, job: "DEVELOPER" as JobFunction, ...range });
    expect(ev[0]).not.toHaveProperty("jobFunction");
  });
});
```

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/modules/leave/calendar-service.test.ts
```

기대: `job` 파라미터 미지원 + AND에 직무 제약 없음으로 새 케이스 FAIL.

### Step 3 — 구현

`src/modules/leave/services/calendar.ts` 수정.

(a) 파일 상단 import에 타입 추가(`import "server-only"` 아래):

```ts
import type { JobFunction } from "@prisma/client";
```

(b) `getLeaveCalendar` 파라미터 타입에 `job` 추가:

```ts
export async function getLeaveCalendar(params: {
  viewerId: string;
  canViewAllStatuses: boolean; // admin:view — 전 상태 + 타인 상세(사유·세부) 마스킹 해제
  canCrossTeam: boolean; // status:view 또는 admin:view — 팀 경계 없이 타인 조회
  start: Date;
  end: Date;
  filterTeamId?: string | null;
  job?: JobFunction | null; // 직무 필터(D1/D7) — null/미지정 = 무필터
}): Promise<LeaveCalendarEvent[]> {
```

(c) `const rangeAnd = [...]`(line 27) **바로 아래**에 직무 교집합 절을 추가하고, AND 배열을 합성한다:

```ts
  const { viewerId, canViewAllStatuses, canCrossTeam, start, end } = params;
  const rangeAnd = [{ startDate: { lte: end } }, { endDate: { gte: start } }];

  // 직무 필터(D1/D7): job 지정 시 그 jobFunction의 ACTIVE userId 집합과 AND 교집합.
  // LeaveRequest엔 user 관계가 없어 userId 집합으로 거른다(빈 집합 → {in:[]} → 빈 결과). jobFunction은 응답에 싣지 않음.
  const andClauses: Array<Record<string, unknown>> = [...rangeAnd];
  if (params.job) {
    const jobUsers = await prisma.user.findMany({
      where: { jobFunction: params.job, status: "ACTIVE" },
      select: { id: true },
    });
    andClauses.push({ userId: { in: jobUsers.map((u) => u.id) } });
  }
```

(d) 세 분기의 `AND: rangeAnd`를 모두 `AND: andClauses`로 교체한다(3곳: admin / cross-team / 일반).

- admin 분기:
  ```ts
      where = {
        deletedAt: null,
        AND: andClauses,
        ...(teamIds ? { userId: { in: teamIds } } : {}),
      };
  ```
- cross-team(status) 분기:
  ```ts
      where = {
        deletedAt: null,
        AND: andClauses,
        OR: [{ userId: viewerId }, others],
      };
  ```
- 일반(self) 분기:
  ```ts
      where = {
        deletedAt: null,
        AND: andClauses,
        OR: [
          { userId: viewerId },
          ...(teamOthers.length ? [{ userId: { in: teamOthers }, status: "APPROVED" as const }] : []),
        ],
      };
  ```

(e) `rows.map(...)` 반환 객체는 **변경 없음**(`jobFunction` 추가하지 않음, D7).

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/modules/leave/calendar-service.test.ts
```

기대: 새 describe 5건 + 기존 케이스(일반/status/admin) 전부 PASS.

> 기존 케이스는 `job`을 넘기지 않아 직무 user 조회가 실행되지 않으므로 `prisma.user.findMany` 호출 순서가 그대로다 — 회귀 없음.

### Step 5 — 커밋

```bash
git add src/modules/leave/services/calendar.ts tests/modules/leave/calendar-service.test.ts
git commit -m "feat(leave): 캘린더 서비스 직무 필터(jobFunction userId 교집합·미노출)"
```

## Acceptance Criteria

- `npm test -- tests/modules/leave/calendar-service.test.ts` → 신규+기존 전부 green.
- `npm run typecheck` → 통과.
- 반환 `LeaveCalendarEvent`에 `jobFunction` 필드 없음(D7).
- `job` 미지정 시 `prisma.user.findMany`가 직무 조회로 추가 호출되지 않음(기존 호출 순서 보존).

## Cautions

- **Don't 직무 제약을 top-level `userId` 키로 넣지 마라.** 이유: admin 분기는 이미 `userId: { in: teamIds }`를 top-level에 둘 수 있어 키 충돌. AND 배열에 push하면 모든 분기에서 교집합으로 안전하게 합쳐진다.
- **Don't `LeaveCalendarEvent`에 `jobFunction`을 추가하지 마라.** 이유: 데이터 최소화(D7) — 필터링이 서버에서 끝나므로 코워커 직무 속성을 클라이언트로 보내지 않는다.
- **Don't 이름 조회 쿼리(`select:{id,name}`)를 바꾸지 마라.** 이유: 직무는 필터 where에만 쓰고 표시엔 불필요.
