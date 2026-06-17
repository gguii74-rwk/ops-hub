import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearHandlers, dispatch, handlersFor, registerHandler } from "@/kernel/events";

describe("event registry", () => {
  beforeEach(() => clearHandlers());

  it("registers handlers and finds them by type; unknown types return none", () => {
    registerHandler("leave.request.approved", vi.fn());
    expect(handlersFor("leave.request.approved")).toHaveLength(1);
    expect(handlersFor("unknown.type")).toHaveLength(0);
  });

  it("dispatch invokes every handler registered for the type", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    registerHandler("workflows.task.created", a);
    registerHandler("workflows.task.created", b);
    await dispatch({ type: "workflows.task.created", payload: { id: "1" } });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("dispatch with no handlers is a no-op (Phase 1 state)", async () => {
    await expect(dispatch({ type: "nothing.registered.yet", payload: {} })).resolves.toBeUndefined();
  });
});
