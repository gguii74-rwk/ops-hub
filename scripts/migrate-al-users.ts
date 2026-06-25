/**
 * annual-leave 사용자 → ops-hub User 적재 (1회성 마이그레이션).
 *
 * 입력: scripts/migrate-al-users-export.py가 만든 JSON 배열 파일.
 * 사용: npx tsx scripts/migrate-al-users.ts <users.json> [--dry-run]
 * 설계·매핑 규칙: docs/migration/2026-06-22-annual-leave-users.md
 *
 * create-only(이미 있는 email은 skip) — 기존 OWNER·재실행 안전. 매핑 수정 재반영은 수동.
 */
import { readFileSync } from "node:fs";
import {
  PrismaClient,
  type EmploymentType,
  type JobFunction,
  type SystemRole,
  type UserStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

interface AlUser {
  email: string;
  password: string;
  name: string;
  department: string | null;
  position: string | null;
  joinDate: string | null;
  role: string;
  isActive: boolean;
  accountStatus: string;
}

// 제외: 본인(이미 ops-hub OWNER) · 퇴사자
const EXCLUDE = new Set(["ggui74@uracle.co.kr", "hatecoding@uracle.co.kr"]);

const DEPT_JOB: Record<string, JobFunction> = {
  개발팀: "DEVELOPER",
  관리자: "DEVELOPER",
  컨텐츠팀: "CONTENT_MANAGER",
  민원응대팀: "CIVIL_RESPONSE",
};

// employmentType:jobFunction → AccessRole key (seed-roles 기준)
const ROLE_KEY: Record<string, string> = {
  "REGULAR:DEVELOPER": "regular-developer",
  "CONTRACTOR:DEVELOPER": "contractor-developer",
  "CONTRACTOR:CONTENT_MANAGER": "contractor-content",
  "CONTRACTOR:CIVIL_RESPONSE": "contractor-civil-response",
};

interface Mapped {
  email: string;
  name: string;
  passwordHash: string;
  position: string | null;
  joinDate: Date | null;
  employmentType: EmploymentType;
  jobFunction: JobFunction;
  systemRole: SystemRole;
  status: UserStatus;
  roleKeys: string[];
}

function mapUser(u: AlUser): Mapped {
  const email = u.email.toLowerCase();
  const employmentType: EmploymentType = email.endsWith("@uracle.co.kr") ? "REGULAR" : "CONTRACTOR";
  const jobFunction = DEPT_JOB[u.department ?? ""];
  if (!jobFunction) throw new Error(`미지 department: ${u.department} (${email})`);
  const systemRole: SystemRole = u.role === "ADMIN" ? "ADMIN" : "MEMBER";
  const status: UserStatus = u.isActive ? "ACTIVE" : "DISABLED";
  const baseKey = ROLE_KEY[`${employmentType}:${jobFunction}`];
  if (!baseKey) throw new Error(`미지 role 매핑: ${employmentType}/${jobFunction} (${email})`);
  const roleKeys = [baseKey];
  if (u.role === "ADMIN") roleKeys.push("admin");
  return {
    email,
    name: u.name,
    passwordHash: u.password,
    position: u.position,
    joinDate: u.joinDate ? new Date(u.joinDate) : null,
    employmentType,
    jobFunction,
    systemRole,
    status,
    roleKeys,
  };
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!file) {
    console.error("사용: tsx scripts/migrate-al-users.ts <users.json> [--dry-run]");
    process.exit(1);
  }

  // 오적재 방지 — opshub 외 DB(safety_report 등) 차단
  if (!process.env.DATABASE_URL?.includes("/opshub")) {
    throw new Error(
      `DATABASE_URL이 opshub가 아님 — 중단: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@")}`,
    );
  }

  const raw: AlUser[] = JSON.parse(readFileSync(file, "utf8"));
  const verifiedAt = new Date();

  // AccessRole key→id 1회 로드
  const roles = await prisma.accessRole.findMany({ select: { id: true, key: true } });
  const roleId = new Map(roles.map((r) => [r.key, r.id]));

  let created = 0;
  let skipped = 0;
  let excluded = 0;
  for (const u of raw) {
    const email = u.email.toLowerCase();
    if (EXCLUDE.has(email)) {
      excluded++;
      console.log(`제외     ${email}`);
      continue;
    }
    const m = mapUser(u);
    const ids = m.roleKeys.map((k) => {
      const id = roleId.get(k);
      if (!id) throw new Error(`AccessRole '${k}' 없음 — db:seed 필요 (${email})`);
      return id;
    });

    if (dryRun) {
      console.log(
        `적재예정 ${email} | ${m.employmentType}/${m.jobFunction} | ${m.systemRole} | ${m.status} | [${m.roleKeys.join(", ")}]`,
      );
      created++;
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      skipped++;
      console.log(`skip     ${email} (이미 존재)`);
      continue;
    }

    await prisma.user.create({
      data: {
        email: m.email,
        name: m.name,
        passwordHash: m.passwordHash,
        position: m.position,
        joinDate: m.joinDate,
        employmentType: m.employmentType,
        jobFunction: m.jobFunction,
        systemRole: m.systemRole,
        status: m.status,
        emailVerifiedAt: verifiedAt,
        mustChangePassword: false,
        roleAssignments: { create: ids.map((id) => ({ roleId: id })) },
      },
    });
    created++;
    console.log(`적재     ${email} | ${m.systemRole} | ${m.status} | [${m.roleKeys.join(", ")}]`);
  }

  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}완료: 적재 ${created} / skip ${skipped} / 제외 ${excluded} (입력 ${raw.length})`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
