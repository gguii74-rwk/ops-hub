# Task 03 — 사용자 목록 집계(stats) 백엔드

사용자 StatStrip(승인 대기/전체/활성/외주)이 필터와 무관한 전수 집계를 필요로 한다. `listUsers`에 `stats:{total,active,contractor}`를 추가한다 — 기존 `pendingCount`와 **완전히 같은 패턴**(필터 무관 `prisma.user.count`). 쓰기·마이그레이션 없음.

## Files

- Modify `src/modules/admin/users/repositories/index.ts` (`listUsers` 반환 타입·구현)

## Prep

- entrypoint §Shared Contracts의 "사용자 목록 집계".
- 현재 `listUsers`(repositories/index.ts) 시그니처:
  `export async function listUsers(f): Promise<{ rows: UserRow[]; total: number; pendingCount: number }>`
  내부 `Promise.all([findMany(...), count({where}), count({where:{status:"PENDING"}})])`.
- `listUsersForView`(services/index.ts)와 GET `/api/admin/users`(route.ts)는 `listUsers` 결과를 **그대로 통과**시키므로 추가 변경 불필요(타입 자동 전파).

## Deps

없음.

## Cautions

- **TDD 예외(문서화):** 이 변경은 DB 집계(prisma.count)라 순수 단위테스트 대상이 없다 — 검증 없이 추가하는 `pendingCount`와 동형이다. 검증은 `typecheck` + 전체 스위트 green으로 한다. **Don't** 억지로 prisma를 목킹한 테스트를 만들지 말 것. Reason: 기존 코드의 집계 패턴과 일관, 과도한 목킹은 깨지기 쉬운 테스트만 남긴다.
- `stats.total`(전수)과 페이지네이션용 `total`(필터 적용)을 **혼동하지 말 것** — 둘 다 유지한다. Reason: `total`은 페이지 계산에, `stats.total`은 요약 카드에 쓰인다.
- 활성=`status: "ACTIVE"`, 외주=`employmentType: "CONTRACTOR"`(전수, 필터 무관).

## Steps

### 1. 반환 타입 확장

`listUsers`의 반환 타입 주석/시그니처를 확장한다. 현재:

```ts
export async function listUsers(f: UserListFilter): Promise<{ rows: UserRow[]; total: number; pendingCount: number }> {
```

수정:

```ts
export async function listUsers(
  f: UserListFilter,
): Promise<{ rows: UserRow[]; total: number; pendingCount: number; stats: { total: number; active: number; contractor: number } }> {
```

### 2. 집계 추가

현재 `Promise.all`:

```ts
  const [rows, total, pendingCount] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize,
      select: {
        id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
        systemRole: true, teamId: true, team: { select: { name: true } }, createdAt: true, updatedAt: true,
        roleAssignments: { select: { role: { select: { key: true } } } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { status: "PENDING" } }),
  ]);
```

수정(전수 집계 3건 추가 — 모두 필터 무관):

```ts
  const [rows, total, pendingCount, statTotal, statActive, statContractor] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize,
      select: {
        id: true, email: true, name: true, status: true, employmentType: true, jobFunction: true,
        systemRole: true, teamId: true, team: { select: { name: true } }, createdAt: true, updatedAt: true,
        roleAssignments: { select: { role: { select: { key: true } } } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { employmentType: "CONTRACTOR" } }),
  ]);
```

### 3. 반환에 stats 추가

현재 `return { rows: rows.map(...), total, pendingCount };`의 끝을 수정:

```ts
  return {
    rows: rows.map((u) => ({
      id: u.id, email: u.email, name: u.name, status: u.status,
      employmentType: u.employmentType, jobFunction: u.jobFunction, systemRole: u.systemRole,
      teamId: u.teamId, teamName: u.team?.name ?? null, createdAt: u.createdAt, updatedAt: u.updatedAt, roleKeys: u.roleAssignments.map((ra) => ra.role.key),
    })),
    total, pendingCount,
    stats: { total: statTotal, active: statActive, contractor: statContractor },
  };
```

`employmentType: "CONTRACTOR"`가 Prisma enum 타입과 맞는지 typecheck로 확인(스키마 enum 값과 동일 — 문자열 리터럴 허용). 불일치 시 기존 `where` 캐스팅 패턴(`as Prisma.UserWhereInput["employmentType"]`)을 동일 적용.

### 4. 커밋

```
git add src/modules/admin/users/repositories/index.ts
git commit -m "feat(admin): 사용자 목록 요약 집계(전수/활성/외주) 추가"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors — stats가 service/route로 자동 전파
npm run lint        # 0 errors
npm test            # 기존 스위트 green(회귀 없음)
```

기대: `listUsers` 결과에 `stats:{total,active,contractor}` 포함, GET `/api/admin/users` 응답에 동일 필드 통과. (소비는 task-04.)
