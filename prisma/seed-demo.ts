import { PrismaClient, type WorkflowStatus } from "@prisma/client";

const prisma = new PrismaClient();

// dev 전용 데모 데이터 — 메인 seed.ts(roles/admin/config 부트스트랩)와 분리.
// production/cutover의 `db:seed` 경로엔 절대 포함되지 않는다(가짜 데이터가 권위 데이터로 주입되는 것 방지).
async function upsertEvent(
  id: string,
  taskId: string,
  fromStatus: WorkflowStatus | null,
  toStatus: WorkflowStatus,
  actorId: string | null,
) {
  await prisma.workflowTaskEvent.upsert({
    where: { id },
    update: {},
    create: { id, taskId, fromStatus, toStatus, actorId },
  });
}

async function main() {
  const now = new Date();
  const day = (d: number) => new Date(now.getFullYear(), now.getMonth(), d, 9, 0);

  const owner = await prisma.user.findFirst({ where: { systemRole: "OWNER" } });
  if (!owner) {
    console.warn("[seed-demo] OWNER 사용자가 없어 데모를 건너뜁니다. 먼저 `npm run db:seed` 실행.");
    await prisma.$disconnect();
    return;
  }
  const createdById = owner.id;

  // 1. WorkflowType 3종
  const weekly = await prisma.workflowType.upsert({
    where: { kind: "WEEKLY_REPORT" },
    update: {},
    create: { id: "wf-weekly", kind: "WEEKLY_REPORT", name: "주간보고", templatePath: "Template/weekly.docx", recurrence: "WEEKLY" },
  });
  const billing = await prisma.workflowType.upsert({
    where: { kind: "BILLING" },
    update: {},
    create: { id: "wf-billing", kind: "BILLING", name: "대금청구", templatePath: "Template/billing.hwpx", recurrence: "MONTHLY" },
  });
  const notif = await prisma.workflowType.upsert({
    where: { kind: "NOTIFICATION_BILLING" },
    update: {},
    create: { id: "wf-notification", kind: "NOTIFICATION_BILLING", name: "알림톡", templatePath: "Template/notification.hwpx", recurrence: "MONTHLY" },
  });

  // 2. sample-task-1 (weekly, PENDING) — 캘린더 데모와 공유. 초기 이벤트 포함.
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-1" },
    update: { scheduledAt: day(12) },
    create: { id: "sample-task-1", typeId: weekly.id, scheduledAt: day(12), status: "PENDING", createdById },
  });
  await upsertEvent("evt-1-0", "sample-task-1", null, "PENDING", createdById);

  // 3. sample-task-2 (billing, GENERATED) — 생성 파일 + FAILED 메일(재시도 데모).
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-2" },
    update: {},
    create: { id: "sample-task-2", typeId: billing.id, scheduledAt: day(15), status: "GENERATED", createdById, generatedAt: day(15) },
  });
  await upsertEvent("evt-2-0", "sample-task-2", null, "PENDING", createdById);
  await upsertEvent("evt-2-1", "sample-task-2", "PENDING", "GENERATED", createdById);
  await prisma.generatedFile.upsert({
    where: { id: "file-2-1" },
    update: {},
    create: { id: "file-2-1", taskId: "sample-task-2", path: "out/billing-2026-06.hwpx", displayName: "대금청구_2026-06.hwpx", mimeType: "application/octet-stream", sizeBytes: 20480n },
  });
  await prisma.mailDelivery.upsert({
    where: { id: "mail-2-1" },
    update: {},
    create: {
      id: "mail-2-1", taskId: "sample-task-2", step: "send", status: "FAILED",
      recipients: ["billing@uracle.co.kr"], subject: "[대금청구] 2026년 6월", bodyHtml: "<p>대금청구 본문(데모)</p>",
      attachmentPaths: ["out/billing-2026-06.hwpx"], errorMessage: "SMTP 연결 실패(데모)", sentById: createdById, sentAt: null,
    },
  });

  // 4. sample-task-3 (notification, SENT) — 정상 발송 이력(SENT 배지 데모).
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-3" },
    update: {},
    create: { id: "sample-task-3", typeId: notif.id, scheduledAt: day(18), status: "SENT", createdById, generatedAt: day(18), sentAt: day(18) },
  });
  await upsertEvent("evt-3-0", "sample-task-3", null, "PENDING", createdById);
  await upsertEvent("evt-3-1", "sample-task-3", "PENDING", "GENERATED", createdById);
  await upsertEvent("evt-3-2", "sample-task-3", "GENERATED", "SENT", createdById);
  await prisma.mailDelivery.upsert({
    where: { id: "mail-3-1" },
    update: {},
    create: {
      id: "mail-3-1", taskId: "sample-task-3", step: "send", status: "SENT",
      recipients: ["client@example.com"], subject: "[알림톡] 결제 안내", bodyHtml: "<p>알림톡 본문(데모)</p>",
      providerMessageId: "demo-msg-3", sentById: createdById, sentAt: day(18),
    },
  });

  // 5. sample-task-4 (weekly, GENERATED) — SENDING 잔여 메일('확인 필요' + admin resolve 데모).
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-4" },
    update: {},
    create: { id: "sample-task-4", typeId: weekly.id, scheduledAt: day(20), status: "GENERATED", createdById, generatedAt: day(20) },
  });
  await upsertEvent("evt-4-0", "sample-task-4", null, "PENDING", createdById);
  await upsertEvent("evt-4-1", "sample-task-4", "PENDING", "GENERATED", createdById);
  await prisma.mailDelivery.upsert({
    where: { id: "mail-4-1" },
    update: {},
    create: {
      id: "mail-4-1", taskId: "sample-task-4", step: "send", status: "SENDING",
      recipients: ["team@uracle.co.kr"], subject: "[주간보고] SENDING 데모", bodyHtml: "<p>주간보고 본문(데모)</p>",
      sentById: createdById, sentAt: null,
    },
  });

  // 6. 데모 LeaveRequest(기존) — OWNER 귀속.
  await prisma.leaveRequest.upsert({
    where: { id: "sample-leave-1" },
    update: {},
    create: { id: "sample-leave-1", userId: owner.id, leaveType: "ANNUAL", startDate: day(15), endDate: day(16), days: 2, status: "APPROVED", reason: "데모 연차" },
  });

  console.log("[seed-demo] WorkflowType 3종 + task/event/mail + LeaveRequest 데모 seed 완료(dev 전용).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
