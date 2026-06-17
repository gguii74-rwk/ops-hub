# Task 09 — seed (admin · roles · permission matrix · nav)

목적: 로그인·권한·메뉴가 동작하도록 초기 데이터를 멱등하게 적재한다 — Permission 카탈로그, AccessRole 5종, 보수적 초기 권한 매트릭스(ALLOW만), OWNER admin 1명, NavigationItem 5종.

## Files

- Create: `prisma/seed.ts`
- Modify: `package.json` (prisma.seed, db:seed 스크립트, devDependencies)

## Prep

- §Shared Contracts **SC-9**(카탈로그·역할·nav 키). RESOURCES/ACCESS_ROLE_KEYS/NAV는 `src/kernel/access/catalog.ts`가 단일 출처 — seed는 **재정의하지 않고 import**한다(드리프트 방지). `ROLE_ALLOW` 매트릭스만 seed-local.
- [access-control.md](../../architecture/access-control.md) "초기 권한 매트릭스 초안". **"제한" 셀은 정책 미정** → 이번 seed는 명확한 ALLOW만 넣고 나머지는 fail-closed로 거부 상태로 둔다(엔진 기본 거부).

## Deps

03(스키마·마이그레이션 적용됨, DB 필요).

## Steps

### 1. 의존성·스크립트

```bash
npm install -D tsx
```

`package.json`에 추가(기존 항목 보존):

```json
"scripts": {
  "db:seed": "prisma db seed"
},
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

`scripts`는 기존 블록에 `db:seed` 한 줄을 더하고, `prisma` 키는 top-level에 추가한다.

### 2. seed 스크립트 — `prisma/seed.ts`

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
// SC-9 단일 출처(catalog.ts)에서 import — 재정의 금지(드리프트 방지).
// 상대경로: tsx의 tsconfig paths(@ alias) 해석 의존을 피한다.
import { ACCESS_ROLE_KEYS, NAV as NAV_CATALOG, RESOURCES } from "../src/kernel/access/catalog";

const prisma = new PrismaClient();

// view는 전 resource에 부여. resource 목록은 catalog가 단일 출처.
const VIEW_RESOURCES = [...RESOURCES];

const EXTRA_PERMISSIONS: Array<[string, string]> = [
  ["workflows.weekly", "create"], ["workflows.weekly", "generate"], ["workflows.weekly", "send"],
  ["workflows.billing", "create"], ["workflows.billing", "send"],
  ["workflows.notification", "create"], ["workflows.notification", "send"],
  ["leave.request", "create"],
  ["leave.approval", "approve"],
  ["leave.allocation", "configure"],
  ["admin.users", "update"],
  ["admin.settings", "configure"],
  ["integrations.google", "configure"],
  ["integrations.smtp", "configure"],
  ["integrations.templates", "configure"],
];

// 역할 키는 catalog(ACCESS_ROLE_KEYS)가 단일 출처. 표시명만 seed-local.
const ROLE_NAMES: Record<string, string> = {
  pm: "PM",
  "regular-developer": "정규 개발자",
  "contractor-developer": "외주 개발자",
  "contractor-content": "외주 컨텐츠관리",
  "contractor-civil-response": "외주 민원응대",
};
const ACCESS_ROLES = ACCESS_ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] ?? key }));

// role → 허용 "resource:action" 키. 명확한 셀만(ALLOW). "제한"은 미포함 → 거부 유지.
const ROLE_ALLOW: Record<string, string[]> = {
  // pm 권한은 OWNER systemRole로 전부 허용되지만, 비-OWNER PM 대비 명시 ALLOW도 부여.
  pm: ["*"],
  "regular-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "calendar.team:view", "workflows.weekly:view", "workflows.billing:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.weekly:generate",
    "workflows.notification:create",
  ],
  "contractor-developer": [
    "dashboard:view", "calendar.work:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-content": [
    "dashboard:view", "calendar.work:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-civil-response": [
    "dashboard:view", "calendar.work:view", "calendar.personal:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.notification:create",
  ],
};

// nav도 catalog(NAV)가 단일 출처. 순서(sortOrder)만 여기서 부여.
const NAV = NAV_CATALOG.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));

function splitKey(key: string): { resource: string; action: string } {
  const idx = key.lastIndexOf(":");
  return { resource: key.slice(0, idx), action: key.slice(idx + 1) };
}

async function main() {
  // 1. Permissions
  const defs = new Map<string, { resource: string; action: string }>();
  for (const resource of VIEW_RESOURCES) defs.set(`${resource}:view`, { resource, action: "view" });
  for (const [resource, action] of EXTRA_PERMISSIONS) defs.set(`${resource}:${action}`, { resource, action });

  const permissionIdByKey = new Map<string, string>();
  for (const [key, { resource, action }] of defs) {
    const p = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    permissionIdByKey.set(key, p.id);
  }

  // 2. AccessRoles
  const roleIdByKey = new Map<string, string>();
  for (const role of ACCESS_ROLES) {
    const r = await prisma.accessRole.upsert({
      where: { key: role.key },
      update: { name: role.name },
      create: { key: role.key, name: role.name, isSystem: true },
    });
    roleIdByKey.set(role.key, r.id);
  }

  // 3. RolePermissions (ALLOW만). 매트릭스를 "정확히" 반영하도록 역할별로 기존 행을 지우고 재삽입한다.
  //    단순 upsert는 매트릭스에서 뺀 키의 stale ALLOW를 남겨 권한이 새는 함정이다(F1).
  const allKeys = [...permissionIdByKey.keys()];
  for (const role of ACCESS_ROLES) {
    const wanted = ROLE_ALLOW[role.key] ?? [];
    const keys = wanted.includes("*") ? allKeys : wanted;
    const roleId = roleIdByKey.get(role.key)!;
    const rows = keys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id)) // 카탈로그에 없는 키는 제외
      .map((permissionId) => ({ roleId, permissionId, effect: "ALLOW" as const, scope: "all" }));
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({ data: rows, skipDuplicates: true }),
    ]);
  }

  // 4. Admin (PM, OWNER). 특권 계정은 약한/기본 비밀번호로 만들지 않는다 — 미설정/짧으면 즉시 중단(E1).
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@uracle.co.kr";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error(
      "SEED_ADMIN_PASSWORD가 없거나 12자 미만 — OWNER 계정을 만들지 않고 중단합니다.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  // 비밀번호는 "생성 시에만" 설정한다(update:{}). 재seed가 수동 변경된 비밀번호를 덮어쓰지 않게 함(F2).
  // 회전은 별도 admin 작업으로 처리한다.
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: "관리자",
      employmentType: "REGULAR",
      jobFunction: "PM",
      systemRole: "OWNER",
      status: "ACTIVE",
    },
  });
  const pmRoleId = roleIdByKey.get("pm")!;
  await prisma.userAccessRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: pmRoleId } },
    update: {},
    create: { userId: admin.id, roleId: pmRoleId },
  });

  // 5. NavigationItems — 선언된 permission은 반드시 해석돼야 한다. 미해석이면 fail-closed로 중단한다
  //    (null로 두면 loadNavigation이 공개로 취급 → 오타가 메뉴를 공개로 만드는 함정, E3).
  for (const item of NAV) {
    const { resource, action } = splitKey(item.permission);
    const permission = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
      select: { id: true },
    });
    if (!permission) {
      throw new Error(
        `nav '${item.key}'의 권한 '${item.permission}'을 카탈로그에서 찾지 못함 — 중단(메뉴가 공개로 새는 것 방지).`,
      );
    }
    await prisma.navigationItem.upsert({
      where: { key: item.key },
      update: {
        label: item.label,
        href: item.href,
        sortOrder: item.sortOrder,
        requiredPermissionId: permission.id,
        isActive: true,
      },
      create: {
        key: item.key,
        label: item.label,
        href: item.href,
        sortOrder: item.sortOrder,
        requiredPermissionId: permission.id,
      },
    });
  }

  console.log(
    `seed 완료: permissions=${defs.size}, roles=${ACCESS_ROLES.length}, nav=${NAV.length}, admin=${email}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

### 3. 실행 (DB 필요)

```bash
SEED_ADMIN_PASSWORD='개발용-강한-비밀번호' npm run db:seed
```

(Windows PowerShell: `$env:SEED_ADMIN_PASSWORD='...'; npm run db:seed`)

### 4. 멱등성 검증 — 한 번 더 실행

```bash
npm run db:seed   # 에러 없이 같은 결과(중복 행 없음)
```

### 5. 적재 확인

```bash
npx prisma studio   # User 1, AccessRole 5, NavigationItem 5, Permission/RolePermission 존재 확인
```

### 6. 검증

```bash
npm run typecheck   # seed.ts 포함 에러 0
npm run lint        # 에러 0 (prisma/seed.ts는 src 밖이라 boundaries 대상 아님)
```

### 7. 커밋

```bash
git add -A
git commit -m "Add seed: permissions, access roles, initial matrix, owner admin, navigation"
```

## Acceptance Criteria

- `npm run db:seed`가 성공하고, **두 번 실행해도** 중복 없이 동일 상태(멱등).
- seed가 RESOURCES/ACCESS_ROLE_KEYS/NAV를 catalog에서 import한다(로컬 재정의 없음).
- `SEED_ADMIN_PASSWORD` 미설정(또는 12자 미만)이면 seed가 `exit(1)`로 중단하고 OWNER를 만들지 않는다.
- `ROLE_ALLOW`에서 키를 제거하고 재seed하면 해당 RolePermission이 사라진다(stale ALLOW 없음 — 역할별 delete+createMany 재조정).
- nav 항목의 권한 키가 카탈로그에서 해석 안 되면 seed가 throw한다(메뉴 공개 누수 방지).
- User 1명(OWNER, PM), AccessRole 5종, NavigationItem 5종, Permission/RolePermission 적재. admin이 `pm` 역할을 갖고, NavigationItem 각각이 `requiredPermissionId`로 연결된다.
- typecheck/lint 에러 0.

## Cautions

- **Don't "제한" 셀을 임의 정책으로 ALLOW하지 마라. Reason:** access-control.md가 정책 미정으로 표시한 칸이다. fail-closed(미포함=거부)로 두고 정책 확정 후 추가한다.
- **Don't 약한/기본 비밀번호로 OWNER를 만들지 마라. Reason:** `SEED_ADMIN_PASSWORD`(≥12자)가 없으면 `exit(1)`로 중단한다(fail-closed). 기본값 적재는 특권 계정 fail-open이라 금지.
- **Don't catalog 배열(RESOURCES/ACCESS_ROLE_KEYS/NAV)을 seed에서 재정의하지 마라. Reason:** SC-9 단일 출처. 재정의하면 seed·nav·엔진이 조용히 어긋난다. import로만 쓴다.
- **Don't RolePermission을 upsert만 하고 정리하지 마라. Reason:** 매트릭스에서 뺀 키의 stale ALLOW가 남아 권한이 샌다. 역할별 `deleteMany` 후 `createMany`로 정확히 재조정한다.
- **Don't 멱등성을 깨지 마라. Reason:** permission/role/nav/user는 upsert(재실행·CI 안전). `@@unique` 인자명(`resource_action`, `userId_roleId`)은 생성 타입을 따른다 — 다르면 typecheck가 알려준다.
