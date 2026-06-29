import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { $executeRaw: vi.fn() } }));

import { prisma } from "@/lib/prisma";
import { acquireGenerationLease, releaseGenerationLease, GENERATION_LEASE_TTL_MS } from "@/modules/workflows/repositories/generation-lock";

const exec = (prisma as unknown as { $executeRaw: ReturnType<typeof vi.fn> }).$executeRaw;

beforeEach(() => { exec.mockReset(); });

describe("acquireGenerationLease (J1 CAS)", () => {
  it("affected-rows 1 → true(점유 성공)", async () => {
    exec.mockResolvedValue(1);
    expect(await acquireGenerationLease("t1", "h1")).toBe(true);
  });
  it("affected-rows 0 → false(타인이 유효 lease 보유 → 호출부 409)", async () => {
    exec.mockResolvedValue(0);
    expect(await acquireGenerationLease("t1", "h2")).toBe(false);
  });
  it("기본 TTL은 2분", () => {
    expect(GENERATION_LEASE_TTL_MS).toBe(120_000);
  });
});

describe("releaseGenerationLease", () => {
  it("DELETE 실행(holder 일치 시만 — steal된 lease는 안 지움)", async () => {
    exec.mockResolvedValue(1);
    await releaseGenerationLease("t1", "h1");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
