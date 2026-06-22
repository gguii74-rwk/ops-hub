import "server-only";
import type { PrismaTx } from "@/lib/prisma";

// 사용자 도메인 메일 본문 묶음(leave MailJob과 동형). 트랜잭션에 넘겨 enqueue.
export interface UserMailJob { recipients: string[]; subject: string; bodyHtml: string }
export type UserMailEvent = "APPROVED" | "REJECTED" | "VERIFY_EMAIL";

// 공통 MailDelivery에 사용자 메일을 enqueue — leaveRequestId=null(NULL은 @@unique([leaveRequestId,eventType]) 충돌을 일으키지 않음,
// Postgres unique는 NULL을 distinct로 취급 → 사용자 메일은 멱등키 없이 매번 새 행). eventType엔 UserMailEvent를 그대로 문자열로 저장.
export async function enqueueUserMail(
  tx: PrismaTx,
  args: { eventType: UserMailEvent } & UserMailJob,
): Promise<void> {
  await tx.mailDelivery.create({
    data: {
      leaveRequestId: null, eventType: args.eventType, status: "PENDING",
      recipients: args.recipients, subject: args.subject, bodyHtml: args.bodyHtml, attempts: 0,
    },
  });
}
