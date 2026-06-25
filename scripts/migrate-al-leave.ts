/**
 * annual-leave 연차 데이터 → ops-hub 적재 (dev 1회성 마이그레이션).
 *
 * 입력: scripts/migrate-al-leave-export.py가 만든 JSON 파일
 *       { usersIdEmail, allocations, requests, history }.
 * 사용: npx tsx scripts/migrate-al-leave.ts <al-leave.json> [--dry-run] [--reset]
 * 설계·매핑 규칙: docs/migration/2026-06-25-annual-leave-data.md
 *
 * - 행 id(uuid)는 보존(멱등 + history.allocationId FK 자동 일치).
 * - 사용자 참조 FK만 email로 opshub userId에 remap. 소유자가 opshub에 없거나 제외면 레코드 skip.
 * - usedDays는 이전된 APPROVED 신청 days 합으로 재계산(시작연도 KST 귀속, spec D7).
 * - 기본 skip-duplicate(재실행 안전). --reset은 leave.* 비우고 clean reload.
 */
import { readFileSync } from "node:fs";
import {
  PrismaClient,
  Prisma,
  LeaveType,
  LeaveSubType,
  LeaveRequestStatus,
  AllocationChangeType,
} from "@prisma/client";

const prisma = new PrismaClient();

// 소유자 제외(본인 OWNER). hatecoding(퇴사)은 opshub에 없어 자동 제외.
const EXCLUDE_OWNER_EMAILS = new Set(["ggui74@uracle.co.kr"]);

interface AlAllocation {
  id: string;
  userId: string;
  year: number;
  allocatedDays: number;
  carriedOverDays: number;
  carriedOverExpiryDate: string | number | null;
  usedDays: number;
}
interface AlRequest {
  id: string;
  userId: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: string | number;
  endDate: string | number;
  days: number;
  reason: string | null;
  status: string;
  appliedAt: string | number | null;
  reviewedBy: string | null;
  reviewedAt: string | number | null;
  rejectionReason: string | null;
  cancelledAt: string | number | null;
  cancellationReason: string | null;
  isCarriedOver: boolean | number;
  createdAt: string | number | null;
  createdByAdminId: string | null;
  createdByAdminAt: string | number | null;
  modifiedByAdminId: string | null;
  modifiedByAdminAt: string | number | null;
  adminActionNote: string | null;
}
interface AlHistory {
  id: string;
  allocationId: string;
  userId: string;
  changeType: string;
  changeDays: number;
  reason: string;
  reasonDetail: string | null;
  beforeDays: number;
  afterDays: number;
  createdBy: string | null;
  createdAt: string | number | null;
}
interface AlData {
  usersIdEmail: Array<{ id: string; email: string }>;
  allocations: AlAllocation[];
  requests: AlRequest[];
  history: AlHistory[];
}

// 날짜 변환(fail-loud). Prisma SQLite는 ISO 문자열 또는 epoch ms — new Date 둘 다 처리.
function toDate(v: string | number | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`잘못된 날짜 값: ${JSON.stringify(v)}`);
  return d;
}
// KST 연도(시작연도 귀속용) — TZ 무관하게 +9h 후 UTC 연도.
function kstYear(d: Date): number {
  return new Date(d.getTime() + 9 * 3600 * 1000).getUTCFullYear();
}
function asEnum<T extends Record<string, string>>(
  e: T,
  v: string,
  field: string,
): T[keyof T] {
  const out = e[v as keyof T];
  if (out === undefined) throw new Error(`미지 ${field}: ${v}`);
  return out;
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const reset = process.argv.includes("--reset");
  if (!file) {
    console.error("사용: tsx scripts/migrate-al-leave.ts <al-leave.json> [--dry-run] [--reset]");
    process.exit(1);
  }
  // 오적재 방지 — opshub 외 DB(safety_report 등) 차단
  if (!process.env.DATABASE_URL?.includes("/opshub")) {
    throw new Error(
      `DATABASE_URL이 opshub가 아님 — 중단: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@")}`,
    );
  }

  const data: AlData = JSON.parse(readFileSync(file, "utf8"));

  // 소스 userId(uuid) → email(소문자)
  const srcEmail = new Map(data.usersIdEmail.map((u) => [u.id, u.email.toLowerCase()]));
  // opshub email(소문자) → userId(cuid)
  const opshubUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const opshubByEmail = new Map(opshubUsers.map((u) => [u.email.toLowerCase(), u.id]));

  const stats = { skippedOwner: 0, nulledRef: 0, missingAllocation: 0 };

  // 소유자 매핑: opshub에 있고 제외 대상 아니면 opshub userId, 아니면 null(=레코드 skip)
  function resolveOwner(sourceUserId: string): string | null {
    const email = srcEmail.get(sourceUserId);
    if (!email || EXCLUDE_OWNER_EMAILS.has(email)) return null;
    return opshubByEmail.get(email) ?? null;
  }
  // 참조(검토자/관리자) 매핑: 있으면 opshub id, 없으면 null(+카운트)
  function resolveRef(sourceUserId: string | null): string | null {
    if (!sourceUserId) return null;
    const email = srcEmail.get(sourceUserId);
    const id = email ? opshubByEmail.get(email) : undefined;
    if (!id) {
      stats.nulledRef++;
      return null;
    }
    return id;
  }

  // --- allocations ---
  const loadedAllocationIds = new Set<string>();
  const allocationRows: Prisma.LeaveAllocationCreateManyInput[] = [];
  const sourceUsed = new Map<string, number>(); // userId:year → 소스 usedDays(진단용)
  for (const a of data.allocations) {
    const userId = resolveOwner(a.userId);
    if (!userId) {
      stats.skippedOwner++;
      continue;
    }
    loadedAllocationIds.add(a.id);
    sourceUsed.set(`${userId}:${a.year}`, a.usedDays);
    allocationRows.push({
      id: a.id,
      userId,
      year: a.year,
      allocatedDays: a.allocatedDays,
      carriedOverDays: a.carriedOverDays,
      carriedOverExpiryDate: toDate(a.carriedOverExpiryDate),
      usedDays: 0, // 아래 재계산으로 갱신
    });
  }

  // --- requests ---
  const requestRows: Prisma.LeaveRequestCreateManyInput[] = [];
  for (const r of data.requests) {
    const userId = resolveOwner(r.userId);
    if (!userId) {
      stats.skippedOwner++;
      continue;
    }
    requestRows.push({
      id: r.id,
      userId,
      leaveType: asEnum(LeaveType, r.leaveType, "leaveType"),
      leaveSubType: r.leaveSubType ? asEnum(LeaveSubType, r.leaveSubType, "leaveSubType") : null,
      quarterStartTime: r.quarterStartTime,
      startDate: toDate(r.startDate)!,
      endDate: toDate(r.endDate)!,
      days: r.days,
      reason: r.reason,
      status: asEnum(LeaveRequestStatus, r.status, "status"),
      appliedAt: toDate(r.appliedAt) ?? undefined,
      reviewedById: resolveRef(r.reviewedBy),
      reviewedAt: toDate(r.reviewedAt),
      rejectionReason: r.rejectionReason,
      cancelledAt: toDate(r.cancelledAt),
      cancellationReason: r.cancellationReason,
      isCarriedOver: Boolean(r.isCarriedOver),
      adminActionNote: r.adminActionNote,
      createdByAdminId: resolveRef(r.createdByAdminId),
      createdByAdminAt: toDate(r.createdByAdminAt),
      modifiedByAdminId: resolveRef(r.modifiedByAdminId),
      modifiedByAdminAt: toDate(r.modifiedByAdminAt),
      createdAt: toDate(r.createdAt) ?? undefined,
    });
  }

  // --- history (allocation 제외 시 함께 skip) ---
  const historyRows: Prisma.LeaveAllocationHistoryCreateManyInput[] = [];
  for (const h of data.history) {
    const userId = resolveOwner(h.userId);
    if (!userId) {
      stats.skippedOwner++;
      continue;
    }
    if (!loadedAllocationIds.has(h.allocationId)) {
      stats.missingAllocation++;
      continue;
    }
    historyRows.push({
      id: h.id,
      allocationId: h.allocationId,
      userId,
      changeType: asEnum(AllocationChangeType, h.changeType, "changeType"),
      changeDays: h.changeDays,
      reason: h.reason,
      reasonDetail: h.reasonDetail,
      beforeDays: h.beforeDays,
      afterDays: h.afterDays,
      createdById: resolveRef(h.createdBy),
      createdAt: toDate(h.createdAt) ?? undefined,
    });
  }

  // --- usedDays 재계산: APPROVED 신청 days 합을 (userId, 시작연도 KST)에 귀속 ---
  const usedByKey = new Map<string, number>();
  for (const r of requestRows) {
    if (r.status !== "APPROVED") continue;
    const key = `${r.userId}:${kstYear(r.startDate as Date)}`;
    usedByKey.set(key, (usedByKey.get(key) ?? 0) + Number(r.days));
  }
  const divergences: string[] = [];
  for (const a of allocationRows) {
    const key = `${a.userId}:${a.year}`;
    const computed = usedByKey.get(key) ?? 0;
    a.usedDays = computed;
    const src = sourceUsed.get(key) ?? 0;
    if (Math.abs(computed - src) > 0.001) {
      divergences.push(`  ${a.userId} ${a.year}: source=${src} computed=${computed}`);
    }
  }

  // --- 요약 ---
  console.log(
    `${dryRun ? "[DRY-RUN] " : ""}${reset ? "[RESET] " : ""}매핑 결과: ` +
      `allocation ${allocationRows.length}/${data.allocations.length}, ` +
      `request ${requestRows.length}/${data.requests.length}, ` +
      `history ${historyRows.length}/${data.history.length} ` +
      `(소유자제외 ${stats.skippedOwner}, allocation없음 ${stats.missingAllocation}, 참조null ${stats.nulledRef})`,
  );
  if (divergences.length) {
    console.log(`usedDays 소스↔재계산 불일치 ${divergences.length}건(재계산값 적재):`);
    console.log(divergences.join("\n"));
  }

  if (dryRun) {
    console.log("[DRY-RUN] DB 미변경.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (reset) {
      await tx.leaveAllocationHistory.deleteMany({});
      await tx.leaveRequest.deleteMany({});
      await tx.leaveAllocation.deleteMany({});
    }
    await tx.leaveAllocation.createMany({ data: allocationRows, skipDuplicates: true });
    await tx.leaveRequest.createMany({ data: requestRows, skipDuplicates: true });
    await tx.leaveAllocationHistory.createMany({ data: historyRows, skipDuplicates: true });
  });

  console.log("적재 완료.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
