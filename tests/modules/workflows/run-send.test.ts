import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("node:fs", () => ({ default: { readdirSync: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ resolveStoragePath: vi.fn((p: string) => `/abs/${p}`) }));
vi.mock("@/modules/workflows/repositories", () => ({ findTaskForSend: vi.fn() }));
vi.mock("@/modules/workflows/services/mail", () => ({ deliver: vi.fn() }));

import fs from "node:fs";
import { ForbiddenError } from "@/kernel/access";
import { ConflictError, NotImplementedError } from "@/modules/workflows/types";
import { findTaskForSend } from "@/modules/workflows/repositories";
import { deliver } from "@/modules/workflows/services/mail";
import { runSend } from "@/modules/workflows/services/send";

const findTask = findTaskForSend as unknown as ReturnType<typeof vi.fn>;
const deliverFn = deliver as unknown as ReturnType<typeof vi.fn>;
const readdir = fs.readdirSync as unknown as ReturnType<typeof vi.fn>;
const ctx = (keys: string[]) => ({ userId: "u1", isOwner: false, permissionKeys: new Set(keys) });
const baseTask = { id: "t1", status: "GENERATED", kind: "BILLING", outputPath: "out/workflows/t1", recipients: null, defaultRecipients: null };

beforeEach(() => {
  findTask.mockReset().mockResolvedValue(baseTask);
  deliverFn.mockReset().mockResolvedValue({ id: "d1", status: "SENT" });
  readdir.mockReset().mockReturnValue(["(공문)a.hwpx", "기성계.hwpx", "memo.txt"]);
});

describe("runSend (1·2단계, D7·D11·G2b·I1·F2)", () => {
  it("step 3 → NotImplementedError(422, F2)", async () => {
    await expect(runSend("t1", { step: 3, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(NotImplementedError);
  });
  it("task 없음 → Forbidden", async () => {
    findTask.mockResolvedValue(null);
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("send 권한 없으면 Forbidden(fail-closed)", async () => {
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:view"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("수신자 미해석(input/task/default 모두 없음) → Conflict, deliver 미호출(I1)", async () => {
    await expect(runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
    expect(deliverFn).not.toHaveBeenCalled();
  });
  it("step1: hwpx만 첨부 + deliver(expectedTaskStatus=GENERATED, onDelivered→SENT)", async () => {
    await runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "t1", step: "1", expectedTaskStatus: "GENERATED",
      onDelivered: { fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" },
      msg: expect.objectContaining({
        to: ["a@x.com"],
        attachments: [
          { filename: "(공문)a.hwpx", path: path.join("/abs/out/workflows/t1", "(공문)a.hwpx") },
          { filename: "기성계.hwpx", path: path.join("/abs/out/workflows/t1", "기성계.hwpx") },
        ],
      }),
    }));
  });
  it("step2: 첨부 없음 + deliver(expectedTaskStatus=SENT, onDelivered→HQ_REQUESTED)", async () => {
    findTask.mockResolvedValue({ ...baseTask, status: "SENT" });
    await runSend("t1", { step: 2, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({
      step: "2", expectedTaskStatus: "SENT",
      onDelivered: { fromStatus: "SENT", toStatus: "HQ_REQUESTED", actorId: "u1" },
      msg: expect.objectContaining({ attachments: [] }),
    }));
    expect(readdir).not.toHaveBeenCalled();
  });
  it("step1 outputPath 없음 → Conflict", async () => {
    findTask.mockResolvedValue({ ...baseTask, outputPath: null });
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("step1 디렉터리에 hwpx/xlsx 없음 → Conflict", async () => {
    readdir.mockReturnValue(["memo.txt"]);
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("수신자 폴백: input 없으면 task.recipients 사용", async () => {
    findTask.mockResolvedValue({ ...baseTask, recipients: ["task@x.com"] });
    await runSend("t1", { step: 1, subject: "s", body: "b" }, ctx(["workflows.billing:send"]));
    expect(deliverFn).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.objectContaining({ to: ["task@x.com"] }) }));
  });
  it("onDelivered 성공 시 finalizeDeliveryWithTransition이 호출됨(G2b, 09-M1)", async () => {
    // deliver mock이 onDelivered를 받았을 때 실제로 finalizeDeliveryWithTransition에 위임하는지
    // 검증하려면 deliver 자체를 실 구현으로 실행해야 하지만, mail.service 테스트에서 이미 G2b를 커버한다.
    // 여기선 deliver가 onDelivered 인자와 함께 호출됐는지(runSend가 연결했는지)를 단언한다.
    await runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]));
    const call = deliverFn.mock.calls[0][0];
    expect(call.onDelivered).toEqual({ fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" });
  });
  it("status-guard 충돌(createSendingDelivery ConflictError) → ConflictError 전파", async () => {
    deliverFn.mockRejectedValue(new ConflictError("상태가 이미 변경되었습니다."));
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toBeInstanceOf(ConflictError);
  });
  it("I4: resolveStoragePath가 throw하면(절대/..경로) → 에러 전파", async () => {
    const { resolveStoragePath } = await import("@/lib/storage");
    (resolveStoragePath as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error("strict: 허용 안 된 경로"); });
    await expect(runSend("t1", { step: 1, subject: "s", body: "b", recipients: ["a@x.com"] }, ctx(["workflows.billing:send"]))).rejects.toThrow("strict");
  });
});
