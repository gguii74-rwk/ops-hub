# Task 03 — 메일 outbox 인프라(repo·drain worker·수신자·drain API)

**목적:** spec §8/엔트리포인트 §SC-4의 outbox+lease 계약을 구현한다. 트랜잭션 내부 idempotent insert, lease 기반 claim, 조건부 finalize, soft-delete cancel, 하이브리드 drain(서비스 함수 + cron API). 도메인 연결은 Task 06.

## Files
- Create: `src/modules/leave/repositories/mail.ts`
- Create: `src/modules/leave/services/mail.ts`
- Create: `src/modules/leave/mail-templates.ts`
- Create: `src/app/api/leave/mail/drain/route.ts`
- Modify: `.env.example` (LEAVE_MAIL_DRAIN_TOKEN 추가)
- Create: `tests/modules/leave/mail-outbox.test.ts`
- Create: `tests/modules/leave/mail-drain.test.ts`

## Prep
- 엔트리포인트 §SC-4(메일 outbox 계약) 정독 — 상수·후보조건·claim·finalize·cancel.
- 참조 SSOT(패턴만): `src/modules/workflows/repositories/mail.ts`(조건부 update·P2002 처리), `src/modules/workflows/services/mail.ts`(deliver의 "SMTP 실패만 FAILED" 원칙).
- 발송기: `sendMail(msg)`→`{ providerMessageId }`, 테스트는 `setMailTransportForTests` 또는 `vi.mock`.
- 수신자: `User` 모델 `systemRole`(OWNER/ADMIN/MANAGER/MEMBER), `status`(ACTIVE…).
- 원본 메일 본문: `C:\workspace\annual-leave\backend\src\services\email.service.ts`(제목/본문 참고).

## Deps
Task 01(MailDelivery 필드·MailDeliveryStatus PENDING/CANCELLED).

## Steps

### 1. (TDD) repository 테스트 → FAIL

`tests/modules/leave/mail-outbox.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const db = {
    mailDelivery: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  };
  return { db, prisma: db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import {
  insertPendingDelivery, cancelPendingDeliveries, listDueDeliveryIds, claimDelivery, finalizeDelivery,
  MAIL_MAX_ATTEMPTS,
} from "@/modules/leave/repositories/mail";

beforeEach(() => vi.clearAllMocks());

describe("insertPendingDelivery", () => {
  it("PENDING 행을 tx로 생성", async () => {
    h.db.mailDelivery.create.mockResolvedValue({ id: "m1" });
    await insertPendingDelivery(h.db as never, { leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>" });
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: "r1", eventType: "REQUESTED", status: "PENDING", attempts: 0 }),
    }));
  });
  it("@@unique 충돌(P2002)은 조용히 무시", async () => {
    h.db.mailDelivery.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(insertPendingDelivery(h.db as never, { leaveRequestId: "r1", eventType: "REQUESTED", recipients: [], subject: "s", bodyHtml: "" })).resolves.toBeUndefined();
  });
});

describe("cancelPendingDeliveries", () => {
  it("PENDING/FAILED/SENDING(active 포함)을 CANCELLED로 — terminal(SENT/CANCELLED)만 제외", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 2 });
    await cancelPendingDeliveries(h.db as never, "r1");
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leaveRequestId: "r1", status: { in: ["PENDING", "FAILED", "SENDING"] } },
      data: expect.objectContaining({ status: "CANCELLED", lockedUntil: null }),
    }));
  });
});

describe("claimDelivery", () => {
  it("count 1이면 SENDING+lease+attempts++ 후 데이터 반환", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    h.db.mailDelivery.findUnique.mockResolvedValue({ id: "m1", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>", workerId: "w1", status: "SENDING" });
    const out = await claimDelivery("m1", "w1", new Date());
    expect(out).toEqual({ id: "m1", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>" });
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENDING", workerId: "w1", attempts: { increment: 1 } }),
    }));
  });
  it("count 0(선점)이면 null", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimDelivery("m1", "w1", new Date())).toBeNull();
  });
});

describe("finalizeDelivery", () => {
  it("status=SENDING AND workerId=self일 때만(true)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    expect(await finalizeDelivery("m1", "w1", { status: "SENT", providerMessageId: "pm" })).toBe(true);
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m1", status: "SENDING", workerId: "w1" },
    }));
  });
  it("0행이면 false(CANCELLED/선점 — 덮어쓰지 않음)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await finalizeDelivery("m1", "w1", { status: "SENT" })).toBe(false);
  });
});

describe("listDueDeliveryIds", () => {
  it("leave 스코프 + 후보 조건으로 조회", async () => {
    h.db.mailDelivery.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    const ids = await listDueDeliveryIds(new Date(), 50);
    expect(ids).toEqual(["m1", "m2"]);
    const arg = h.db.mailDelivery.findMany.mock.calls[0][0];
    expect(arg.where.leaveRequestId).toEqual({ not: null });
    expect(MAIL_MAX_ATTEMPTS).toBe(3);
  });
});
```
실행 → **FAIL**(모듈 없음).

### 2. repository 구현 → PASS

`src/modules/leave/repositories/mail.ts`:
```ts
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";

export const MAIL_MAX_ATTEMPTS = 3;
export const MAIL_LEASE_MS = 60_000;

export type LeaveMailEvent = "REQUESTED" | "APPROVED" | "REJECTED" | "ADMIN_CREATED";

// 발송 본문 묶음(Task 06이 도메인 tx에 넘기는 형태). insert/templates가 공유.
export interface MailJob { recipients: string[]; subject: string; bodyHtml: string }

// 후보 조건(claim/list 공유): leave 스코프 + 발송 가능 상태. workflow 행(leaveRequestId NULL)은 제외.
function dueWhere(now: Date) {
  return {
    leaveRequestId: { not: null },
    eventType: { not: null },
    OR: [
      { status: "PENDING" as const },
      { status: "FAILED" as const, attempts: { lt: MAIL_MAX_ATTEMPTS } },
      { status: "SENDING" as const, lockedUntil: { lt: now }, attempts: { lt: MAIL_MAX_ATTEMPTS } },
    ],
  };
}

// 트랜잭션 내부 idempotent insert. @@unique(leaveRequestId,eventType) 충돌은 무시(이벤트당 1행 보장).
export async function insertPendingDelivery(
  tx: PrismaTx,
  args: { leaveRequestId: string; eventType: LeaveMailEvent } & MailJob,
): Promise<void> {
  try {
    await tx.mailDelivery.create({
      data: {
        leaveRequestId: args.leaveRequestId, eventType: args.eventType, status: "PENDING",
        recipients: args.recipients, subject: args.subject, bodyHtml: args.bodyHtml, attempts: 0,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // 이미 예약됨
    throw e;
  }
}

// soft-delete tx 내부: 비-terminal outbox를 모두 CANCELLED로. SENT/CANCELLED만 제외, **active SENDING(lease 유효) 포함**.
// active SENDING까지 취소해야 worker 조건부 finalize(WHERE status=SENDING)가 0행이 되어 삭제된 요청에 SENT가 안 남는다
// (삭제-발송 race 안전, spec §8). at-least-once상 그 직전 provider로 이미 나간 메일은 허용(드문 중복 < 누락).
export async function cancelPendingDeliveries(tx: PrismaTx, leaveRequestId: string): Promise<void> {
  await tx.mailDelivery.updateMany({
    where: { leaveRequestId, status: { in: ["PENDING", "FAILED", "SENDING"] } },
    data: { status: "CANCELLED", lockedUntil: null },
  });
}

export async function listDueDeliveryIds(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.mailDelivery.findMany({
    where: dueWhere(now), select: { id: true }, take: limit, orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

export interface ClaimedDelivery { id: string; recipients: string[]; subject: string; bodyHtml: string; }

// atomic 조건부 claim: 후보 조건이 여전히 참일 때만 SENDING+lease+workerId+attempts++. 0행=선점 → null.
export async function claimDelivery(id: string, workerId: string, now: Date): Promise<ClaimedDelivery | null> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, ...dueWhere(now) },
    data: { status: "SENDING", lockedUntil: new Date(now.getTime() + MAIL_LEASE_MS), workerId, attempts: { increment: 1 } },
  });
  if (count !== 1) return null;
  const d = await prisma.mailDelivery.findUnique({
    where: { id }, select: { id: true, recipients: true, subject: true, bodyHtml: true, workerId: true, status: true },
  });
  if (!d || d.status !== "SENDING" || d.workerId !== workerId) return null;
  return {
    id: d.id,
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml ?? "",
  };
}

// 조건부 finalize: status=SENDING AND workerId=self일 때만. 0행=CANCELLED/선점 → false(terminal 덮지 않음).
export async function finalizeDelivery(id: string, workerId: string, patch: {
  status: "SENT" | "FAILED"; providerMessageId?: string | null; errorMessage?: string | null;
}): Promise<boolean> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, status: "SENDING", workerId },
    data: {
      status: patch.status,
      sentAt: patch.status === "SENT" ? new Date() : null,
      providerMessageId: patch.providerMessageId ?? null,
      errorMessage: patch.errorMessage ?? null,
      lockedUntil: null,
    },
  });
  return count === 1;
}
```
실행: 1번 → **PASS**.

### 3. mail-templates 구현

`src/modules/leave/mail-templates.ts`(순수 — server-only 불필요하나 도메인 모듈; UI import 안 함):
```ts
import { getFullLeaveText } from "./labels";

export interface MailReqLike {
  leaveType: string; leaveSubType: string | null; quarterStartTime: string | null;
  startDate: Date; endDate: Date; reason: string | null;
}

function fmtRange(start: Date, end: Date): string {
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return f(start) === f(end) ? f(start) : `${f(start)} ~ ${f(end)}`;
}
function detail(req: MailReqLike): string {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime);
  return `<ul><li>유형: ${type}</li><li>기간: ${fmtRange(req.startDate, req.endDate)}</li>${req.reason ? `<li>사유: ${req.reason}</li>` : ""}</ul>`;
}

export function buildRequestNotification(applicantName: string, req: MailReqLike) {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime);
  return { subject: `[연차 신청] ${applicantName}님의 ${type} 신청`, html: `<p>${applicantName}님이 연차를 신청했습니다.</p>${detail(req)}<p>승인 대기 목록에서 처리해 주세요.</p>` };
}
export function buildApprovedNotification(req: MailReqLike) {
  return { subject: `[연차 승인] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 승인되었습니다`, html: `<p>연차 신청이 승인되었습니다.</p>${detail(req)}` };
}
export function buildRejectedNotification(req: MailReqLike, rejectionReason: string) {
  return { subject: `[연차 반려] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 반려되었습니다`, html: `<p>연차 신청이 반려되었습니다.</p>${detail(req)}<p>반려 사유: ${rejectionReason}</p>` };
}
export function buildAdminCreatedNotification(req: MailReqLike) {
  return { subject: `[연차 등록] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)}가 등록되었습니다`, html: `<p>관리자가 연차를 등록했습니다.</p>${detail(req)}` };
}
```

### 4. (TDD) drain 서비스 테스트 → FAIL

`tests/modules/leave/mail-drain.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() } } }));
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));

import { drainLeaveMailOutbox, getLeaveAdminRecipients } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { hasPermission } from "@/kernel/access";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery) };
const send = vi.mocked(sendMail);

beforeEach(() => vi.clearAllMocks());

describe("drainLeaveMailOutbox", () => {
  it("claim→발송→SENT finalize 성공 시 sent++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "SENT", providerMessageId: "pm" });
  });
  it("claim 실패(선점)면 skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue(null);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });
  it("SMTP 실패면 FAILED finalize + failed++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockRejectedValue(new Error("smtp down"));
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "FAILED", errorMessage: "smtp down" });
  });
  it("발송 성공했지만 finalize 0행(그 사이 CANCELLED)이면 skipped++(SENT로 안 침)", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(false);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });
});

describe("getLeaveAdminRecipients", () => {
  it("후보 중 leave.approval:view 보유자만(permission 기반 — 승인권한 없는 MANAGER 제외)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "a@x.com" }, { id: "u2", email: "b@x.com" },
    ] as never);
    vi.mocked(hasPermission).mockImplementation((async (id: string) => id === "u1") as never); // u2는 승인권한 없음
    expect(await getLeaveAdminRecipients()).toEqual(["a@x.com"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ACTIVE", systemRole: { in: ["OWNER", "ADMIN", "MANAGER"] } },
      select: { id: true, email: true },
    }));
    expect(hasPermission).toHaveBeenCalledWith("u2", "leave.approval", "view");
  });
});
```
실행 → **FAIL**.

### 5. drain 서비스 구현 → PASS

`src/modules/leave/services/mail.ts`:
```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/kernel/access";
import { sendMail } from "@/lib/integrations/mail";
import { listDueDeliveryIds, claimDelivery, finalizeDelivery } from "../repositories/mail";

const DRAIN_BATCH = 50;

// 통지 수신자(REQUESTED용): **permission 기반**(결정) — leave.approval:view 유효 보유자만.
// 후보를 systemRole approver 풀로 좁힌 뒤 hasPermission으로 실권한 확정 → 승인권한 없는 MANAGER 제외(메일로 권한경계 우회 차단).
// 전제: 승인 권한은 approver 역할로 부여된다(표준 경로). MEMBER에게 override로 부여하는 비표준 경로가 생기면 후보 쿼리를 확장.
export async function getLeaveAdminRecipients(): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: { status: "ACTIVE", systemRole: { in: ["OWNER", "ADMIN", "MANAGER"] } },
    select: { id: true, email: true },
  });
  const allowed = await Promise.all(
    candidates.map(async (u) => ((await hasPermission(u.id, "leave.approval", "view")) ? u.email : null)),
  );
  return allowed.filter((e): e is string => e !== null);
}

// 하이브리드 worker의 drain 1회. claim→발송→조건부 finalize. SMTP 실패만 FAILED, finalize 0행은 폐기.
export async function drainLeaveMailOutbox(workerId: string = randomUUID()): Promise<{ sent: number; failed: number; skipped: number }> {
  const ids = await listDueDeliveryIds(new Date(), DRAIN_BATCH);
  let sent = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    const claimed = await claimDelivery(id, workerId, new Date());
    if (!claimed) { skipped++; continue; }
    if (claimed.recipients.length === 0) { // 수신자 없음(예: 관리자 0명) → FAILED 확정, 무한 재시도 방지
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: "수신자 없음" });
      failed++; continue;
    }
    let providerMessageId: string | null = null;
    try {
      ({ providerMessageId } = await sendMail({ to: claimed.recipients, subject: claimed.subject, html: claimed.bodyHtml }));
    } catch (e) {
      await finalizeDelivery(id, workerId, { status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e) });
      failed++; continue;
    }
    const ok = await finalizeDelivery(id, workerId, { status: "SENT", providerMessageId });
    if (ok) sent++; else skipped++; // 0행 = 그 사이 CANCELLED/선점 → SENT로 덮지 않음(삭제-발송 race 안전)
  }
  return { sent, failed, skipped };
}
```
실행: 4번 → **PASS**.

### 6. drain API 라우트 + env

`src/app/api/leave/mail/drain/route.ts`:
```ts
import { NextResponse } from "next/server";
import { drainLeaveMailOutbox } from "@/modules/leave/services/mail";

// 시스템 cron이 주기 호출(누락 보충, at-least-once). 세션이 아니라 공유 토큰으로 가드.
export async function POST(req: Request) {
  const expected = process.env.LEAVE_MAIL_DRAIN_TOKEN;
  if (!expected || req.headers.get("x-drain-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await drainLeaveMailOutbox();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```
`.env.example`에 추가:
```
# 연차 메일 outbox drain 라우트 인증 토큰(시스템 cron이 x-drain-token 헤더로 전달)
LEAVE_MAIL_DRAIN_TOKEN=
```

## Acceptance Criteria
- `npx vitest run tests/modules/leave/mail-outbox.test.ts tests/modules/leave/mail-drain.test.ts` → all passed.
- `npm test` → 회귀 없음.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 통과(eslint boundaries: `repositories/mail.ts`는 `@/lib/prisma`만; `services/mail.ts`는 repo+integrations+`@/kernel/access`(hasPermission — 수신자 권한 확정)만 import).

## Cautions
- **Don't** drain에서 발송 성공 후 finalize가 0행일 때 sent로 세지 마라. 이유: 그 사이 soft-delete가 `CANCELLED`로 바꾼 것 — terminal을 덮으면 삭제된 요청에 "발송됨" 이력이 남는다(spec §8 race).
- **Don't** `listDueDeliveryIds`/`claimDelivery`에서 `leaveRequestId: { not: null }` 조건을 빼지 마라. 이유: 공유 테이블의 workflow 발송 행(`taskId` 기반)을 leave worker가 집어 오염시킨다.
- **Don't** drain 라우트를 세션 권한으로만 막지 마라. 이유: cron은 세션이 없다 — 공유 토큰 필수.
- **Don't** `attempts` 증가를 claim에서 빼지 마라. 이유: stale SENDING reclaim이 무한 재발송된다(`attempts < N` 게이트가 무력화).
