import "server-only";
import { randomUUID } from "node:crypto";
import type { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveScope } from "@/kernel/access";
import { sendMail } from "@/lib/integrations/mail";
import { listDueDeliveryIds, claimDelivery, finalizeDelivery, deadLetterStaleSending } from "../repositories/mail";

const DRAIN_BATCH = 50;

// leave 이벤트가 '발송 시점에 유효'하려면 신청이 가져야 할 현재 상태. 어긋나면 stale 통지 → 미발송.
const LEAVE_EVENT_EXPECTED_STATUS: Record<string, LeaveRequestStatus> = {
  REQUESTED: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ADMIN_CREATED: "APPROVED",
};

// 통지 수신자(REQUESTED용): **scope 기반**(결정) — leave.approval:view 유효 보유자 전원.
// all-scope → 무조건 포함. team-scope → 신청자와 같은 팀(팀 active)이고 team.active인 경우 포함.
// F-II: 팀장도 **예외 없이 leave.approval:view 보유 시에만** 포함한다(사용자 결정). 팀장은 F3 불변식상 그 팀의 active
//   소속원이므로 team-scope leave.approval:view를 보유하면 아래 후보 루프가 이미 포함한다. leadUserId만으로 무조건
//   추가하면(과거 동작) approval 권한 없는 팀장이 휴가 상세를 받고, 위임 admin이 팀장 임명으로 매트릭스 밖에서
//   휴가데이터 접근을 간접 부여하게 된다 → lead 단축 경로 제거. 알림 수신은 전적으로 leave.approval:view가 결정.
// **발송 시점 재확정의 SSOT**: drain이 REQUESTED 발송 직전 이 함수를 다시 호출해 '현재' 권한 보유자에게만 보낸다
// (enqueue 시 저장된 스냅샷을 신뢰하지 않음 — claim~발송 사이 권한을 잃은 사람에게 상세가 새는 것 차단).
// 규모 전제: 사내 도구라 active 사용자 수가 작다(수십). 인원이 크게 늘면 권한 테이블 직접 조회로 단일 쿼리화.
export async function getLeaveAdminRecipients(applicantTeamId: string | null): Promise<string[]> {
  const teamActive = applicantTeamId != null
    ? (await prisma.team.findUnique({ where: { id: applicantTeamId }, select: { active: true } }))?.active === true
    : false;
  const candidates = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, email: true, teamId: true },
  });
  const emails = new Set<string>();
  await Promise.all(candidates.map(async (u) => {
    if (!u.email) return;
    const scope = await getEffectiveScope(u.id, "leave.approval", "view");
    if (scope === "all") emails.add(u.email);
    else if (scope === "team" && teamActive && applicantTeamId != null && u.teamId === applicantTeamId) emails.add(u.email);
  }));
  return [...emails];
}

// 하이브리드 worker의 drain 1회. claim→(leave면 재확인)→발송→조건부 finalize. SMTP 실패만 FAILED, finalize 0행은 폐기.
export async function drainLeaveMailOutbox(workerId: string = randomUUID()): Promise<{ sent: number; failed: number; skipped: number }> {
  await deadLetterStaleSending(new Date()); // 크래시로 표류한 stale SENDING(attempts>=N)을 FAILED로 종결(finding)
  const ids = await listDueDeliveryIds(new Date(), DRAIN_BATCH);
  let sent = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    const claimed = await claimDelivery(id, workerId, new Date());
    if (!claimed) { skipped++; continue; }

    let recipients = claimed.recipients;
    // ── leave 메일(leaveRequestId 있음): 발송 직전 신청 재확인·REQUESTED 수신자 재확정(기존 동작 완전 보존) ──
    if (claimed.leaveRequestId) {
      // 발송 직전 재확인: claim 후 요청이 soft-delete됐거나(결정 A — "claim 후 삭제" 윈도) FK 없는 leaveRequestId라
      // 요청 자체가 없으면(롤백·수동복구·부분마이그레이션 → 고아 행) 미발송 종결(finding).
      const req = await prisma.leaveRequest.findUnique({ where: { id: claimed.leaveRequestId }, select: { deletedAt: true, status: true, userId: true } });
      if (!req || req.deletedAt) {
        await finalizeDelivery(id, workerId, { status: "CANCELLED", errorMessage: req ? "요청 삭제됨(발송 전 확인)" : "요청 없음(고아 outbox)" });
        skipped++; continue;
      }
      // 발송 시점 status 재확인(SSOT): 이벤트가 가리키는 상태와 현재 상태가 어긋나면 미발송 종결. 일반 취소(CANCELLED·deletedAt=null)는
      // deletedAt 체크에 안 걸리므로 여기서 REQUESTED/APPROVED stale 통지를 차단한다(finding) — cancelTx의 outbox 취소와 이중 안전.
      const expected = LEAVE_EVENT_EXPECTED_STATUS[claimed.eventType];
      if (expected && req.status !== expected) {
        await finalizeDelivery(id, workerId, { status: "CANCELLED", errorMessage: `상태 불일치(${claimed.eventType}↔${req.status}) — 미발송` });
        skipped++; continue;
      }
      // 권한 경계는 '발송 시점'에 강제(결정 A): REQUESTED 통지 수신자(승인권한자)는 enqueue 스냅샷이 아니라
      // 발송 직전 getLeaveAdminRecipients()로 재확정 — claim 후 그 사이 leave.approval:view를 잃은 사람에겐 안 보낸다(finding/high).
      // APPROVED/REJECTED/ADMIN_CREATED는 신청 당사자 대상이라 스냅샷(claimed.recipients) 그대로.
      if (claimed.eventType === "REQUESTED") {
        const applicant = await prisma.user.findUnique({ where: { id: req.userId }, select: { teamId: true } });
        recipients = await getLeaveAdminRecipients(applicant?.teamId ?? null);
      }
    }
    // ── 사용자 메일(leaveRequestId=null): 재확인 없이 스냅샷 수신자로 바로 발송 ──

    if (recipients.length === 0) { // 수신자 없음(승인권한자 0명·전원 권한 회수, 또는 당사자 이메일 없음) → FAILED 확정, 무한 재시도 방지
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: "수신자 없음" });
      failed++; continue;
    }
    let providerMessageId: string | null = null;
    try {
      // sendMail엔 idempotency 키 인자가 없다 — stale reclaim/크래시 후 드문 중복 발송 허용(at-least-once). providerMessageId는 감사용.
      ({ providerMessageId } = await sendMail({ to: recipients, subject: claimed.subject, html: claimed.bodyHtml }));
    } catch (e) {
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e) });
      failed++; continue;
    }
    const ok = await finalizeDelivery(id, workerId, { status: "SENT", providerMessageId });
    if (ok) sent++; else skipped++; // 0행 = 그 사이 CANCELLED/선점 → SENT로 덮지 않음(삭제-발송 race 안전)
  }
  return { sent, failed, skipped };
}

// fire-and-forget 트리거(연차 작업 라우트가 커밋 후 호출). drain 실패(DB/SMTP)가 **unhandled rejection으로
// 프로세스를 흔들지 않도록 반드시 .catch 로깅**한다(finding). 누락 보충은 cron drain이 backstop.
// 사용자 메일도 같은 워커가 처리하므로 동명 트리거를 재사용(S8).
export function triggerLeaveMailDrain(): void {
  void drainLeaveMailOutbox().catch((e) => console.error("[leave-mail] drain trigger failed", e));
}
