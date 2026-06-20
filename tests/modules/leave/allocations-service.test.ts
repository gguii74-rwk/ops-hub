import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/leave/repositories");

import {
  getAllocationSummary,
  adjustAllocation,
  recalculate,
} from "@/modules/leave/services/allocations";
import * as repo from "@/modules/leave/repositories";

const mockRepo = repo as unknown as {
  findActiveAllocation: ReturnType<typeof vi.fn>;
  sumPendingDays: ReturnType<typeof vi.fn>;
  upsertAllocation: ReturnType<typeof vi.fn>;
  adjustAllocationTx: ReturnType<typeof vi.fn>;
  recalculateUsedDaysTx: ReturnType<typeof vi.fn>;
  listAllocations: ReturnType<typeof vi.fn>;
  getAllocationHistory: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("getAllocationSummary", () => {
  it("remaining = total - used - pending", async () => {
    mockRepo.findActiveAllocation.mockResolvedValue({
      allocatedDays: 15,
      carriedOverDays: 3,
      usedDays: 5,
      carriedOverExpiryDate: null,
    });
    mockRepo.sumPendingDays.mockResolvedValue(2);
    const s = await getAllocationSummary("u1", 2026);
    expect(s).toMatchObject({
      totalDays: 18,
      usedDays: 5,
      pendingDays: 2,
      remainingDays: 11,
    });
  });
  it("할당 없으면 null", async () => {
    mockRepo.findActiveAllocation.mockResolvedValue(null);
    expect(await getAllocationSummary("u1", 2026)).toBeNull();
  });
});

describe("adjustAllocation", () => {
  it("repository tx에 위임", async () => {
    mockRepo.adjustAllocationTx.mockResolvedValue({ allocation: {}, history: {} });
    await adjustAllocation(
      {
        userId: "u1",
        year: 2026,
        changeDays: 2,
        changeType: "ADD",
        reason: "보상",
      },
      "admin1"
    );
    expect(mockRepo.adjustAllocationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        changeDays: 2,
        adminId: "admin1",
      })
    );
  });
});

describe("recalculate", () => {
  it("repository tx에 위임", async () => {
    mockRepo.recalculateUsedDaysTx.mockResolvedValue(7);
    expect(await recalculate("u1", 2026)).toBe(7);
  });
});
