import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// dev 전용 데모 데이터 — 메인 seed.ts(roles/admin/config 부트스트랩)와 분리.
// production/cutover의 `db:seed` 경로엔 절대 포함되지 않는다(가짜 승인 휴가·업무가 권위 데이터로 주입되는 것 방지 — 적대적 리뷰 Finding 1).
async function main() {
  const now = new Date();

  const wfType = await prisma.workflowType.upsert({
    where: { kind: "WEEKLY_REPORT" },
    update: {},
    create: { id: "wf-weekly", kind: "WEEKLY_REPORT", name: "주간보고", templatePath: "Template/weekly.docx", recurrence: "WEEKLY" },
  });
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-1" },
    update: { scheduledAt: new Date(now.getFullYear(), now.getMonth(), 12, 9, 0) },
    create: { id: "sample-task-1", typeId: wfType.id, scheduledAt: new Date(now.getFullYear(), now.getMonth(), 12, 9, 0), status: "PENDING" },
  });

  // 데모 휴가는 OWNER 사용자에게 귀속(메인 seed가 먼저 만들어야 함).
  const owner = await prisma.user.findFirst({ where: { systemRole: "OWNER" } });
  if (!owner) {
    console.warn("[seed-demo] OWNER 사용자가 없어 데모 LeaveRequest를 건너뜁니다. 먼저 `npm run db:seed` 실행.");
  } else {
    await prisma.leaveRequest.upsert({
      where: { id: "sample-leave-1" },
      update: {},
      create: { id: "sample-leave-1", userId: owner.id, leaveType: "ANNUAL", startDate: new Date(now.getFullYear(), now.getMonth(), 15), endDate: new Date(now.getFullYear(), now.getMonth(), 16), days: 2, status: "APPROVED", reason: "데모 연차" },
    });
  }

  console.log("[seed-demo] 데모 WorkflowTask/LeaveRequest seed 완료(dev 전용).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
