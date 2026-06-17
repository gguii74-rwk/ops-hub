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
