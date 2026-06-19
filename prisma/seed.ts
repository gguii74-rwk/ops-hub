import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
// SC-9 단일 출처(catalog.ts)에서 import — 재정의 금지(드리프트 방지).
// 상대경로: tsx의 tsconfig paths(@ alias) 해석 의존을 피한다.
import { ACCESS_ROLE_KEYS, NAV as NAV_CATALOG, RESOURCES } from "../src/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "./seed-permissions";
import { ROLE_ALLOW } from "./seed-roles";
import { resolveGoogleOwnerId, googleSourceKey } from "./seed-google";

const prisma = new PrismaClient();

// view는 전 resource에 부여. resource 목록은 catalog가 단일 출처.
const VIEW_RESOURCES = [...RESOURCES];

// 역할 키는 catalog(ACCESS_ROLE_KEYS)가 단일 출처. 표시명만 seed-local.
const ROLE_NAMES: Record<string, string> = {
  pm: "PM",
  "regular-developer": "정규 개발자",
  "contractor-developer": "외주 개발자",
  "contractor-content": "외주 컨텐츠관리",
  "contractor-civil-response": "외주 민원응대",
};
const ACCESS_ROLES = ACCESS_ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] ?? key }));

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

  // 6. CalendarSource — 공휴일(Google 공휴일 캘린더) + 설정된 Google 캘린더(best-effort)
  const HOLIDAY_CAL_ID = "ko.south_korea#holiday@group.v.calendar.google.com";
  await prisma.calendarSource.upsert({
    where: { key: "holiday-kr" },
    update: { name: "대한민국 공휴일", externalId: HOLIDAY_CAL_ID, cacheTtlSeconds: 86_400, syncStatus: "ACTIVE" },
    create: { key: "holiday-kr", kind: "HOLIDAY", name: "대한민국 공휴일", provider: "google", externalId: HOLIDAY_CAL_ID, cacheTtlSeconds: 86_400, visibility: "PUBLIC" },
  });

  const calIdsRow = await prisma.systemSetting.findUnique({ where: { key: "integrations.google.calendarIds" } });
  const calIds = Array.isArray(calIdsRow?.value) ? (calIdsRow.value as string[]) : [];
  // 선택적 owner-map(calId→이메일). 비어 있으면 전부 team(ownerUserId=null) = Phase 3 기본. 채우면 dedup/personal-google 활성(§10).
  const ownersRow = await prisma.systemSetting.findUnique({ where: { key: "integrations.google.calendarOwners" } });
  const ownerEmailByCalId =
    ownersRow?.value && typeof ownersRow.value === "object" && !Array.isArray(ownersRow.value)
      ? (ownersRow.value as Record<string, string>)
      : {};
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const userIdByEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
  for (const calId of calIds) {
    const ownerUserId = resolveGoogleOwnerId(calId, ownerEmailByCalId, userIdByEmail);
    // key는 불투명(calId 해시) — calId(개인 캘린더면 이메일)가 feed 응답으로 새지 않게 한다(§9, 적대적 리뷰 5차).
    // 실제 calId는 externalId에만 보관(provider fetch 대상). name은 admin 식별용 DB 필드라 응답엔 미포함.
    const key = googleSourceKey(calId);
    await prisma.calendarSource.upsert({
      where: { key },
      // ownerUserId는 create·update 모두 설정 — 재seed 시 owner-map 변경이 기존 행에도 반영돼야 attribution이 고착되지 않음(적대적 리뷰).
      update: { externalId: calId, syncStatus: "ACTIVE", ownerUserId },
      create: { key, kind: "GOOGLE_CALENDAR", name: `Google: ${calId}`, provider: "google", externalId: calId, cacheTtlSeconds: 900, visibility: "TEAM", ownerUserId },
    });
  }

  // (데모 WorkflowTask/LeaveRequest는 메인 seed에 두지 않는다 — dev 전용 prisma/seed-demo.ts로 분리. step 3b.)

  console.log(
    `seed 완료: permissions=${defs.size}, roles=${ACCESS_ROLES.length}, nav=${NAV.length}, admin=${email}, calendarSources=seeded`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
