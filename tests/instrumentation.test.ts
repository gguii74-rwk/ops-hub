import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { ensureYearsSynced } = vi.hoisted(() => ({ ensureYearsSynced: vi.fn() }));
vi.mock("@/kernel/holidays", () => ({ ensureYearsSynced }));

import { register } from "@/instrumentation";

const origRuntime = process.env.NEXT_RUNTIME;
beforeEach(() => { vi.clearAllMocks(); process.env.NEXT_RUNTIME = "nodejs"; });
afterEach(() => { process.env.NEXT_RUNTIME = origRuntime; });

describe("register (instrumentation)", () => {
  it("nodejs 외 런타임이면 sync하지 않음", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(ensureYearsSynced).not.toHaveBeenCalled();
  });

  it("부팅 sync를 await하지 않음(느리거나 멈춘 sync가 readiness를 막지 않음)", async () => {
    ensureYearsSynced.mockReturnValue(new Promise(() => {})); // 영원히 미해결
    await register();
    expect(ensureYearsSynced).toHaveBeenCalledWith([
      new Date().getFullYear(), new Date().getFullYear() + 1,
    ]);
  });

  it("부팅 sync 거부는 register를 거부시키지 않음", async () => {
    ensureYearsSynced.mockRejectedValue(new Error("API hang/down"));
    await expect(register()).resolves.toBeUndefined();
  });
});
