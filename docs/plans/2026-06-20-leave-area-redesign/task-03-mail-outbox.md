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
- Create: `tests/modules/leave/mail-templates.test.ts` (HTML 이스케이프)

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
  deadLetterStaleSending, MAIL_MAX_ATTEMPTS,
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
  it("PENDING/FAILED/stale SENDING(lease 만료)만 CANCELLED — active SENDING은 건드리지 않음(정직 finalize 보존)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-07-01T00:00:00Z");
    await cancelPendingDeliveries(h.db as never, "r1", now);
    const arg = h.db.mailDelivery.updateMany.mock.calls[0][0];
    expect(arg.where.leaveRequestId).toBe("r1");
    expect(arg.where.OR).toEqual([
      { status: "PENDING" }, { status: "FAILED" }, { status: "SENDING", lockedUntil: { lt: now } },
    ]);
    expect(arg.data).toMatchObject({ status: "CANCELLED", lockedUntil: null });
  });
});

describe("claimDelivery", () => {
  it("count 1이면 SENDING+lease+attempts++ 후 데이터(leaveRequestId 포함) 반환", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    h.db.mailDelivery.findUnique.mockResolvedValue({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>", workerId: "w1", status: "SENDING" });
    const out = await claimDelivery("m1", "w1", new Date());
    expect(out).toEqual({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>" });
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENDING", workerId: "w1", attempts: { increment: 1 } }),
    }));
  });
  it("count 0(선점)이면 null", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimDelivery("m1", "w1", new Date())).toBeNull();
  });
});

describe("deadLetterStaleSending", () => {
  it("stale SENDING(lease 만료)·attempts>=N을 FAILED로 종결(발송 안 함)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-01T00:00:00Z");
    expect(await deadLetterStaleSending(now)).toBe(1);
    const arg = h.db.mailDelivery.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: "SENDING", lockedUntil: { lt: now }, attempts: { gte: MAIL_MAX_ATTEMPTS } });
    expect(arg.data).toMatchObject({ status: "FAILED", lockedUntil: null });
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

// soft-delete tx 내부: 아직 발송 안 했거나 발송 중이 아닌 행만 CANCELLED — PENDING/FAILED/stale SENDING(lease 만료=크래시).
// **active SENDING(lease 유효, worker 발송중)은 건드리지 않는다** — 정직한 finalize(SENT/FAILED) 보존(결정 A: 실제 나간 메일을
// CANCELLED로 지워 감사를 왜곡하지 않음). 삭제는 deletedAt+AuditLog로 별도 감사. worker는 발송 직전 deletedAt 재확인으로
// 대부분의 "claim 후 삭제"를 미발송 처리한다(drainLeaveMailOutbox). 잔여 윈도(발송 진행 중 삭제)는 SENT로 정직 기록(at-least-once).
export async function cancelPendingDeliveries(tx: PrismaTx, leaveRequestId: string, now: Date): Promise<void> {
  await tx.mailDelivery.updateMany({
    where: {
      leaveRequestId,
      OR: [{ status: "PENDING" }, { status: "FAILED" }, { status: "SENDING", lockedUntil: { lt: now } }],
    },
    data: { status: "CANCELLED", lockedUntil: null },
  });
}

// dead-letter: claim이 attempts를 먼저 올리므로, N번째 claim 후 크래시하면 stale SENDING·attempts>=N으로 남아
// dueWhere(attempts < N)에 안 잡혀 영구 표류한다(finding). 발송하지 않고 FAILED로 종결(운영자 가시·재시도 종료).
export async function deadLetterStaleSending(now: Date): Promise<number> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: {
      leaveRequestId: { not: null }, eventType: { not: null },
      status: "SENDING", lockedUntil: { lt: now }, attempts: { gte: MAIL_MAX_ATTEMPTS },
    },
    data: { status: "FAILED", errorMessage: "최대 시도 초과(stale SENDING 회수 한도)", lockedUntil: null },
  });
  return count;
}

export async function listDueDeliveryIds(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.mailDelivery.findMany({
    where: dueWhere(now), select: { id: true }, take: limit, orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

export interface ClaimedDelivery { id: string; leaveRequestId: string; recipients: string[]; subject: string; bodyHtml: string; }

// atomic 조건부 claim: 후보 조건이 여전히 참일 때만 SENDING+lease+workerId+attempts++. 0행=선점 → null.
export async function claimDelivery(id: string, workerId: string, now: Date): Promise<ClaimedDelivery | null> {
  const { count } = await prisma.mailDelivery.updateMany({
    where: { id, ...dueWhere(now) },
    data: { status: "SENDING", lockedUntil: new Date(now.getTime() + MAIL_LEASE_MS), workerId, attempts: { increment: 1 } },
  });
  if (count !== 1) return null;
  const d = await prisma.mailDelivery.findUnique({
    where: { id }, select: { id: true, leaveRequestId: true, recipients: true, subject: true, bodyHtml: true, workerId: true, status: true },
  });
  if (!d || d.status !== "SENDING" || d.workerId !== workerId || !d.leaveRequestId) return null;
  return {
    id: d.id,
    leaveRequestId: d.leaveRequestId,
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml ?? "",
  };
}

// 조건부 finalize: status=SENDING AND workerId=self일 때만. 0행=CANCELLED/선점 → false(terminal 덮지 않음).
// CANCELLED는 발송 직전 deletedAt 재확인에서 사용(요청 삭제됨 → 미발송 종결).
export async function finalizeDelivery(id: string, workerId: string, patch: {
  status: "SENT" | "FAILED" | "CANCELLED"; providerMessageId?: string | null; errorMessage?: string | null;
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

// HTML 본문에 들어가는 모든 동적 텍스트는 이걸로 이스케이프 — 저장형 HTML 인젝션 차단(finding).
// 사용자/관리자 입력(reason·rejectionReason·name)은 임의 HTML을 담을 수 있다.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function fmtRange(start: Date, end: Date): string {
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return f(start) === f(end) ? f(start) : `${f(start)} ~ ${f(end)}`;
}
function detail(req: MailReqLike): string {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime); // enum→고정 라벨(안전하나 일관성 위해 esc)
  return `<ul><li>유형: ${esc(type)}</li><li>기간: ${fmtRange(req.startDate, req.endDate)}</li>${req.reason ? `<li>사유: ${esc(req.reason)}</li>` : ""}</ul>`;
}

export function buildRequestNotification(applicantName: string, req: MailReqLike) {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime);
  return { subject: `[연차 신청] ${applicantName}님의 ${type} 신청`, html: `<p>${esc(applicantName)}님이 연차를 신청했습니다.</p>${detail(req)}<p>승인 대기 목록에서 처리해 주세요.</p>` };
}
export function buildApprovedNotification(req: MailReqLike) {
  return { subject: `[연차 승인] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 승인되었습니다`, html: `<p>연차 신청이 승인되었습니다.</p>${detail(req)}` };
}
export function buildRejectedNotification(req: MailReqLike, rejectionReason: string) {
  return { subject: `[연차 반려] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 반려되었습니다`, html: `<p>연차 신청이 반려되었습니다.</p>${detail(req)}<p>반려 사유: ${esc(rejectionReason)}</p>` };
}
export function buildAdminCreatedNotification(req: MailReqLike) {
  return { subject: `[연차 등록] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)}가 등록되었습니다`, html: `<p>관리자가 연차를 등록했습니다.</p>${detail(req)}` };
}
```
**(TDD) 이스케이프 테스트** — `tests/modules/leave/mail-templates.test.ts`(신규): `reason`/`rejectionReason`/`applicantName`에 `<img src=x onerror=alert(1)>`·`<a href>`·`"`·angle-bracket 페이로드를 넣고 각 빌더의 `html`에 raw `<`/`>`가 없고 `&lt;`/`&gt;`/`&quot;`로 인코딩되는지 검증. (subject는 HTML 아님 → 이스케이프 대상 아님; 본문 `html`만 검사.)
> 주의: `subject`는 이메일 헤더(HTML 렌더 아님)라 HTML-escape하지 않는다 — 본문 `bodyHtml`만 `esc()` 적용. (헤더 인젝션 방지는 발송기 `sendMail` 책임.)

### 4. (TDD) drain 서비스 테스트 → FAIL

`tests/modules/leave/mail-drain.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() }, leaveRequest: { findUnique: vi.fn() } } }));
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(), deadLetterStaleSending: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));

import { drainLeaveMailOutbox, getLeaveAdminRecipients } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { hasPermission } from "@/kernel/access";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery), dead: vi.mocked(repo.deadLetterStaleSending) };
const send = vi.mocked(sendMail);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null } as never); // 기본: 삭제 안 됨(발송 진행)
  r.dead.mockResolvedValue(0);
});

describe("drainLeaveMailOutbox", () => {
  it("claim→발송→SENT finalize 성공 시 sent++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
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
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockRejectedValue(new Error("smtp down"));
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "FAILED", errorMessage: "smtp down" });
  });
  it("발송 성공했지만 finalize 0행(그 사이 CANCELLED)이면 skipped++(SENT로 안 침)", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(false);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });
  it("발송 직전 요청이 soft-delete돼 있으면 미발송 + CANCELLED finalize + skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: new Date() } as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
  it("drain 시작 시 stale SENDING dead-letter 스윕 호출", async () => {
    r.list.mockResolvedValue([]);
    await drainLeaveMailOutbox("w1");
    expect(r.dead).toHaveBeenCalled();
  });
});

describe("getLeaveAdminRecipients", () => {
  it("전 active 사용자 중 leave.approval:view 보유자만(MEMBER라도 권한 있으면 포함, MANAGER라도 없으면 제외)", async () => {
    // mgr=권한없는 MANAGER(제외), mem=role/override로 권한 받은 MEMBER(포함)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr", email: "mgr@x.com" }, { id: "mem", email: "mem@x.com" },
    ] as never);
    vi.mocked(hasPermission).mockImplementation((async (id: string) => id === "mem") as never);
    expect(await getLeaveAdminRecipients()).toEqual(["mem@x.com"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ACTIVE" }, // systemRole prefilter 없음(role/override 부여자 누락 방지)
      select: { id: true, email: true },
    }));
    expect(hasPermission).toHaveBeenCalledWith("mgr", "leave.approval", "view");
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
import { listDueDeliveryIds, claimDelivery, finalizeDelivery, deadLetterStaleSending } from "../repositories/mail";

const DRAIN_BATCH = 50;

// 통지 수신자(REQUESTED용): **permission 기반**(결정) — leave.approval:view 유효 보유자 전원.
// 전 active 사용자에 hasPermission을 평가 → role/override로 권한 받은 MEMBER도 포함, 승인권한 없는 MANAGER는 제외.
// (systemRole prefilter는 role/override 부여자를 누락시켜 알림 유실 — finding, 제거.) hasPermission이 fail-closed 우선순위(override DENY/ALLOW)를 그대로 적용하므로 권한 로직을 재구현하지 않는다.
// 규모 전제: 사내 도구라 active 사용자 수가 작다(수십). 인원이 크게 늘면 권한 테이블 직접 조회로 단일 쿼리화.
export async function getLeaveAdminRecipients(): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, email: true },
  });
  const allowed = await Promise.all(
    candidates.map(async (u) => ((await hasPermission(u.id, "leave.approval", "view")) ? u.email : null)),
  );
  return allowed.filter((e): e is string => e !== null);
}

// 하이브리드 worker의 drain 1회. claim→발송→조건부 finalize. SMTP 실패만 FAILED, finalize 0행은 폐기.
export async function drainLeaveMailOutbox(workerId: string = randomUUID()): Promise<{ sent: number; failed: number; skipped: number }> {
  await deadLetterStaleSending(new Date()); // 크래시로 표류한 stale SENDING(attempts>=N)을 FAILED로 종결(finding)
  const ids = await listDueDeliveryIds(new Date(), DRAIN_BATCH);
  let sent = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    const claimed = await claimDelivery(id, workerId, new Date());
    if (!claimed) { skipped++; continue; }
    // 발송 직전 재확인: claim 후 요청이 soft-delete됐으면 미발송 종결(결정 A — "claim 후 삭제" 윈도 차단).
    const req = await prisma.leaveRequest.findUnique({ where: { id: claimed.leaveRequestId }, select: { deletedAt: true } });
    if (req?.deletedAt) {
      await finalizeDelivery(id, workerId, { status: "CANCELLED", errorMessage: "요청 삭제됨(발송 전 확인)" });
      skipped++; continue;
    }
    if (claimed.recipients.length === 0) { // 수신자 없음(예: 승인권한자 0명) → FAILED 확정, 무한 재시도 방지
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
- `npx vitest run tests/modules/leave/mail-outbox.test.ts tests/modules/leave/mail-drain.test.ts tests/modules/leave/mail-templates.test.ts` → all passed.
- 코드 점검: 메일 `bodyHtml`의 동적 텍스트(reason/rejectionReason/name)가 모두 `esc()`로 인코딩됨(raw `<`/`>` 미포함).
- `npm test` → 회귀 없음.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 통과(eslint boundaries: `repositories/mail.ts`는 `@/lib/prisma`만; `services/mail.ts`는 repo+integrations+`@/kernel/access`(hasPermission — 수신자 권한 확정)만 import).

## Cautions
- **Don't** drain에서 발송 성공 후 finalize가 0행일 때 sent로 세지 마라. 이유: 그 사이 soft-delete가 `CANCELLED`로 바꾼 것 — terminal을 덮으면 삭제된 요청에 "발송됨" 이력이 남는다(spec §8 race).
- **Don't** `listDueDeliveryIds`/`claimDelivery`에서 `leaveRequestId: { not: null }` 조건을 빼지 마라. 이유: 공유 테이블의 workflow 발송 행(`taskId` 기반)을 leave worker가 집어 오염시킨다.
- **Don't** drain 라우트를 세션 권한으로만 막지 마라. 이유: cron은 세션이 없다 — 공유 토큰 필수.
- **Don't** `attempts` 증가를 claim에서 빼지 마라. 이유: stale SENDING reclaim이 무한 재발송된다(`attempts < N` 게이트가 무력화).
