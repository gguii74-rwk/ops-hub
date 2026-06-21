# Task 01 — 스키마·마이그레이션·권한 카탈로그/시드

**Purpose:** 계정 수명주기(자가가입 C안·승인/거절·세션무효화)와 위임 `admin` 역할의 **데이터·권한 기반**을 깐다. `UserStatus`에 `PENDING`/`REJECTED`, `User`에 비번/검증/세션무효화 필드, D18 레이트리밋용 `RateBucket` 모델을 추가하고, catalog/seed에 `admin` 역할·권한 키를 등록한다. 후속 task(02~09) 전부의 토대.

## Files
- Modify: `prisma/schema.prisma` — `enum UserStatus`(값 2개 추가), `model User`(필드 추가·`passwordHash` nullable·인덱스), `model RateBucket`(신설, kernel 스키마)
- Modify: `src/kernel/access/catalog.ts` — `ACCESS_ROLE_KEYS`에 `"admin"`
- Modify: `prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS`에 `admin.users:create`·`admin.users:approve`·`admin.audit:view`
- Modify: `prisma/seed-roles.ts` — `ROLE_ALLOW`에 `admin` 키 배열
- Modify: `prisma/seed.ts` — `ROLE_NAMES`에 `admin` 표시명(파생 `ACCESS_ROLES`가 `{key:"admin",name:"사용자 관리자",isSystem:true}`를 시드)
- Create: `prisma/migrations/<timestamp>_user_management_account_admin/migration.sql` (`prisma migrate dev`가 생성 — impl 시점, DB 필요)
- Create: `tests/kernel/access/user-management-catalog.test.ts` (catalog/seed 키 단위 검증, DB 불필요)

## Prep
- spec §4(데이터모델/마이그레이션), §6(권한모델), D3/D8/D14/D16/D18.
- entrypoint **§Shared Contracts S1**(스키마 정의 — 아래 그대로 옮김)·**S2**(권한 카탈로그/시드 — 아래 그대로 옮김).
- 시드 메커니즘(기존 `prisma/seed.ts`): `VIEW_RESOURCES`(전 `RESOURCES`×`view`) + `EXTRA_PERMISSIONS`로 `Permission` upsert → `ACCESS_ROLES`(=`ACCESS_ROLE_KEYS.map`)로 `AccessRole` upsert(`isSystem:true` 일괄) → `ROLE_ALLOW`로 `RolePermission` `deleteMany(roleId)`+`createMany(skipDuplicates, effect:ALLOW, scope:all)`. `pm: ["*"]`=전체.
- 마이그레이션 적용·`db:seed`는 DB 필요. `npm run prisma:validate`/`prisma:generate`/`typecheck`/`npm test`(catalog 단위)는 DB 없이 동작.

## Deps
없음 (foundation).

## Steps

### 1. schema.prisma — UserStatus에 PENDING·REJECTED 추가
`prisma/schema.prisma`의 `enum UserStatus`(현재 `INVITED/ACTIVE/DISABLED`)를 S1대로 교체:

```prisma
enum UserStatus {
  PENDING    // 신규 — 자가 신청 후 승인 대기
  INVITED    // 예약(본 증분 미사용)
  ACTIVE
  DISABLED
  REJECTED   // 신규 — 거절된 신청(이력 보존, 자가 재신청 차단)

  @@schema("kernel")
}
```

### 2. schema.prisma — User 필드 추가·passwordHash nullable·인덱스
`model User`에서 ① `passwordHash String` → `String?`로 변경, ② 신규 필드 6개 추가, ③ `@@index([status])` 추가. 기존 필드·관계·다른 인덱스는 보존. 변경 후 `model User`는:

```prisma
model User {
  id             String         @id @default(cuid())
  email          String         @unique
  passwordHash   String?        // 변경: nullable — 자가가입은 set-password 전까지 null(C안). 관리자추가/시드는 즉시 설정
  name           String
  department     String?
  position       String?
  joinDate       DateTime?
  employmentType EmploymentType
  jobFunction    JobFunction
  systemRole     SystemRole     @default(MEMBER)
  status         UserStatus     @default(ACTIVE)
  mustChangePassword   Boolean    @default(false)  // 신규 — 최초 로그인 강제변경(D7)
  passwordChangedAt    DateTime?                    // 신규 — 비번변경 세션무효화 기준(D15)
  sessionInvalidatedAt DateTime?                    // 신규 — 비활성화/재설정 세션무효화 기준(D14·상태전이)
  emailVerifiedAt      DateTime?                    // 신규 — 이메일 소유 검증(D16)
  emailVerifyTokenHash String?                      // 신규 — 검증 겸 set-password 토큰 해시(C안)
  emailVerifyExpiresAt DateTime?                    // 신규 — 토큰 만료
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  roleAssignments     UserAccessRole[]
  permissionOverrides UserPermissionOverride[]
  auditLogs           AuditLog[]               @relation("AuditActor")

  @@index([employmentType, jobFunction])
  @@index([systemRole])
  @@index([status])
  @@schema("kernel")
}
```

### 3. schema.prisma — RateBucket 모델 신설 (D18, kernel 스키마)
`@@schema("kernel")` 모델 그룹(예: `AuditLog` 인근)에 S1대로 추가:

```prisma
// D18 레이트리밋 — DB-backed durable, 다중 인스턴스 안전
model RateBucket {
  id              String   @id @default(cuid())
  scope           String   // "signup:ip" | "signup:email" | "resend:email"
  key             String   // IP 또는 email(소문자)
  windowStartedAt DateTime
  count           Int      @default(0)
  updatedAt       DateTime @updatedAt

  @@unique([scope, key])
  @@index([scope, windowStartedAt])
  @@schema("kernel")
}
```

검증:
```
npm run prisma:validate    # expect: 스키마 유효
npm run prisma:generate    # Prisma Client 재생성(UserStatus 신규 값·RateBucket·User 신규 필드 타입 노출)
```

### 4. 마이그레이션 생성·적용 (DB 필요 — impl 시점)
DB 연결 후:
```
npm run prisma:migrate     # = prisma migrate dev --name user_management_account_admin
```

생성될 `migration.sql` 변경 개요(검증용 — 직접 작성하지 말 것, prisma가 생성):
- `ALTER TYPE "kernel"."UserStatus" ADD VALUE 'PENDING'` / `... ADD VALUE 'REJECTED'` (enum 값 추가)
- `ALTER TABLE "kernel"."User" ALTER COLUMN "passwordHash" DROP NOT NULL` (non-null → nullable, **무손실**: 기존 행 모두 값 보유)
- `ALTER TABLE "kernel"."User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false`, `ADD COLUMN "passwordChangedAt" TIMESTAMP(3)`, `ADD COLUMN "sessionInvalidatedAt" TIMESTAMP(3)`, `ADD COLUMN "emailVerifiedAt" TIMESTAMP(3)`, `ADD COLUMN "emailVerifyTokenHash" TEXT`, `ADD COLUMN "emailVerifyExpiresAt" TIMESTAMP(3)`
- `CREATE INDEX "User_status_idx" ON "kernel"."User"("status")`
- `CREATE TABLE "kernel"."RateBucket" (...)` + `CREATE UNIQUE INDEX "RateBucket_scope_key_key"` + `CREATE INDEX "RateBucket_scope_windowStartedAt_idx"`

> DB가 없으면 이 스텝을 건너뛰고 `prisma:validate`/`generate`로 타입만 확인한다. 마이그레이션 파일 적용·`db:seed`는 DB 연결(로컬/터널) 후 impl 시점에 수행한다.

### 5. 커밋 (스키마)
```
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(user-mgmt): UserStatus PENDING/REJECTED·User 계정수명주기 필드·RateBucket 스키마(task-01)"
```

### 6. 실패 단위테스트 — catalog/seed 키 (DB 불필요)
`tests/kernel/access/user-management-catalog.test.ts` 신규(import 경로는 기존 `tests/kernel/access/leave-permissions.test.ts` 패턴: catalog는 `@/` alias, prisma는 상대경로 `../../../prisma/...`):

```ts
import { describe, it, expect } from "vitest";
import { ACCESS_ROLE_KEYS, RESOURCES, ACTIONS } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

const hasExtra = (r: string, a: string) => EXTRA_PERMISSIONS.some(([res, act]) => res === r && act === a);
const ADMIN_ROLE = [
  "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
  "admin.settings:configure", "admin.audit:view",
];

describe("user-management catalog·seed (task-01)", () => {
  it("ACCESS_ROLE_KEYS에 admin 추가", () => {
    expect(ACCESS_ROLE_KEYS).toContain("admin");
  });

  it("catalog RESOURCES/ACTIONS는 이미 admin 권한을 표현 가능(변경 없음)", () => {
    expect(RESOURCES).toContain("admin.users");
    expect(RESOURCES).toContain("admin.audit");
    expect(ACTIONS).toContain("create");
    expect(ACTIONS).toContain("approve");
    expect(ACTIONS).toContain("update");
  });

  it("EXTRA_PERMISSIONS에 admin.users:create·approve·admin.audit:view 추가", () => {
    expect(hasExtra("admin.users", "create")).toBe(true);
    expect(hasExtra("admin.users", "approve")).toBe(true);
    expect(hasExtra("admin.audit", "view")).toBe(true);
  });

  it("admin.users:update는 이미 존재(보존)", () => {
    expect(hasExtra("admin.users", "update")).toBe(true);
  });

  it("ROLE_ALLOW.admin이 D8 권한 묶음을 정확히 보유", () => {
    expect(ROLE_ALLOW.admin).toBeDefined();
    for (const key of ADMIN_ROLE) {
      expect(ROLE_ALLOW.admin).toContain(key);
    }
  });

  it("pm은 전체(\"*\") 유지(회귀 방지)", () => {
    expect(ROLE_ALLOW.pm).toEqual(["*"]);
  });
});
```

```
npm test -- tests/kernel/access/user-management-catalog   # expect FAIL (admin 키 미존재)
```

### 7. catalog.ts — ACCESS_ROLE_KEYS에 admin
`src/kernel/access/catalog.ts`의 `ACCESS_ROLE_KEYS` 배열에 `"admin"` 추가. `RESOURCES`(`admin.users`/`admin.audit` 보유)·`ACTIONS`(`create`/`update`/`approve` 보유)는 **변경 없음**(S2). 변경 후:

```ts
export const ACCESS_ROLE_KEYS = [
  "pm",
  "admin",
  "regular-developer",
  "contractor-developer",
  "contractor-content",
  "contractor-civil-response",
] as const;
```

### 8. seed-permissions.ts — EXTRA_PERMISSIONS에 admin 키
`prisma/seed-permissions.ts`의 `EXTRA_PERMISSIONS` 배열에서 기존 `["admin.users", "update"]` 줄을 다음 4줄로 확장(나머지 항목·순서는 보존):

```ts
  ["admin.users", "update"],
  ["admin.users", "create"],
  ["admin.users", "approve"],
  ["admin.audit", "view"],
  ["admin.settings", "configure"],
```

(`admin.users:view`는 `VIEW_RESOURCES`(전 resource×view)로 이미 seed되므로 `EXTRA_PERMISSIONS`에 넣지 않는다. `admin.settings:configure`는 기존 항목 — 위치만 인접, 중복 추가 금지.)

### 9. seed-roles.ts — ROLE_ALLOW에 admin 역할
`prisma/seed-roles.ts`의 `ROLE_ALLOW`에 `admin` 키를 추가(S2 목록 그대로). `pm` 바로 뒤, 작업자 역할 앞에 둔다:

```ts
export const ROLE_ALLOW: Record<string, string[]> = {
  // pm 권한은 OWNER systemRole로 전부 허용되지만, 비-OWNER PM 대비 명시 ALLOW도 부여.
  pm: ["*"],
  // 위임 사용자 관리자(D8) — OWNER 없이 사용자관리를 위임. pm/admin 특권 부여는 서비스 가드(D12/D13)가 OWNER-only로 제한.
  admin: [
    "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
    "admin.settings:configure", "admin.audit:view",
  ],
  "regular-developer": [
    // ... 기존 그대로
  ],
  // contractor-* 3역할 기존 그대로
};
```

(기존 작업자 역할 배열은 **변경하지 않는다** — 위는 `admin` 키 추가 위치만 표기.)

### 10. seed.ts — admin 표시명 등록
`prisma/seed.ts`의 `ROLE_NAMES`에 `admin` 줄을 추가한다. `ACCESS_ROLES`는 `ACCESS_ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] ?? key }))`로 파생되고, seed.ts의 `accessRole.upsert`가 `create`에 `isSystem: true`를 일괄 적용하므로 이 한 줄이 S2의 `{key:"admin", name:"사용자 관리자", isSystem:true}` 등록을 완성한다(`ACCESS_ROLES` 배열을 직접 손대지 않음 — 코드베이스 실제 패턴).

```ts
const ROLE_NAMES: Record<string, string> = {
  pm: "PM",
  admin: "사용자 관리자",
  "regular-developer": "정규 개발자",
  "contractor-developer": "외주 개발자",
  "contractor-content": "외주 컨텐츠관리",
  "contractor-civil-response": "외주 민원응대",
};
```

```
npm test -- tests/kernel/access/user-management-catalog   # expect PASS
```

### 11. 커밋 (catalog/seed)
```
git add src/kernel/access/catalog.ts prisma/seed-permissions.ts prisma/seed-roles.ts prisma/seed.ts tests/kernel/access/user-management-catalog.test.ts
git commit -m "feat(user-mgmt): admin AccessRole·권한 키 catalog/seed 보강(task-01)"
```

## Acceptance Criteria
- `npm run prisma:validate` → `The schema at prisma\schema.prisma is valid 🚀` (스키마 유효).
- `npm run prisma:generate` → 성공. `prisma.rateBucket` 타입·`UserStatus.PENDING`/`REJECTED`·`User.mustChangePassword` 등 신규 필드가 Prisma Client에 노출.
- `npm test -- tests/kernel/access/user-management-catalog` → PASS (6 passed).
- `npm test -- tests/kernel/settings/seed-permissions` → PASS (회귀: settings 카탈로그 권한이 여전히 seed에 포함).
- `npm run typecheck` → 그린.
- `npm run lint` → 그린.
- (DB 있을 때만) `npm run prisma:migrate` 적용 후 `npm run db:seed` → `admin` AccessRole + `admin.users:{view,create,update,approve}`·`admin.settings:configure`·`admin.audit:view` RolePermission(ALLOW/all) 생성, 기존 역할·OWNER 보존.

## Cautions
- **`passwordHash`를 `String?`로 바꾸되 기본값/데이터 변환을 넣지 말 것.** 이유: 기존 행은 모두 값을 보유해 무손실 nullable 전환이다. `DEFAULT`나 backfill을 넣으면 불필요한 마이그레이션 잡음·기존 비번 훼손 위험.
- **`UserStatus`에 값을 추가하되 기존 enum 값(`INVITED`/`ACTIVE`/`DISABLED`) 순서를 보존할 것.** 이유: Postgres enum은 추가만 안전(`ALTER TYPE ADD VALUE`). 재배열/삭제는 파괴적 마이그레이션을 유발한다.
- **`RateBucket`을 반드시 `@@schema("kernel")`에 둘 것.** 이유: multiSchema 규약 — `@@schema` 누락 시 `prisma:validate` 실패. workflows/leave/calendar 아님(공개 엔드포인트 인프라는 kernel).
- **`catalog.ts`의 `RESOURCES`/`ACTIONS`를 건드리지 말 것.** 이유: `admin.users`·`admin.audit` resource와 `create`/`update`/`approve` action이 이미 존재(S2). 추가하면 불필요한 변경·중복 view 권한 seed.
- **`seed.ts`의 `ACCESS_ROLES` 배열을 직접 작성하지 말 것.** 이유: `ACCESS_ROLE_KEYS.map`으로 파생되는 단일 출처다. step 7(catalog) + step 10(ROLE_NAMES) 두 곳만 고치면 `admin` 역할이 자동 시드된다(드리프트 방지).
- **`EXTRA_PERMISSIONS`에 `admin.users:view`를 추가하지 말 것.** 이유: `VIEW_RESOURCES`(전 resource×view)가 이미 생성한다 — 중복. 단 seed의 `defs.set` dedup이 흡수하므로 깨지진 않으나 의도 키만 둔다.
- **RolePermission 시드 패턴(`deleteMany`→`createMany`)을 바꾸지 말 것.** 이유: 매트릭스를 정확히 반영(stale ALLOW 누수 방지, seed.ts F1 주석). 단순 upsert로 바꾸면 권한이 샌다.
- **이 task에서 `admin` 권한 게이트 로직(가드·서비스·라우트)을 구현하지 말 것.** 이유: anti-escalation 가드는 task-02, repository는 task-03 — 여기는 스키마·카탈로그·시드만. 가드 상수(`PRIVILEGED_ROLE_KEYS` 등)는 entrypoint §S3(task-02 정의)를 참조.
