import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/repositories/billing", () => ({
  findAllBillingConfig: vi.fn(), findBillingConfigByYear: vi.fn(), createBillingConfig: vi.fn(),
  updateBillingConfigByYear: vi.fn(), deleteBillingConfigByYear: vi.fn(),
  findRoundDatesByYear: vi.fn(), findRoundDate: vi.fn(), upsertRoundDate: vi.fn(), deleteRoundDate: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import * as repo from "@/modules/workflows/repositories/billing";
import {
  listBillingConfig, getBillingConfig, createBillingConfig, updateBillingConfig,
  removeBillingConfig, listRoundDates, saveRoundDate, removeRoundDate,
} from "@/modules/workflows/services/billing-config";

const r = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ctx = (keys: string[], isOwner = false) => ({ isOwner, permissionKeys: new Set(keys) });
const row = {
  id: "c1", year: 2026, projectName: "사업", contractNumber: "R25", contractAmount: 1675080000n,
  monthlyAmount: 139590000n, contractAmountKor: "금...", monthlyAmountKor: "금...",
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
};

beforeEach(() => { Object.values(r).forEach((f) => f.mockReset()); });

describe("billing-config service 권한·DTO", () => {
  it("view 없으면 Forbidden", async () => {
    await expect(listBillingConfig(ctx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("list: BigInt→Number DTO(D5)", async () => {
    r.findAllBillingConfig.mockResolvedValue([row]);
    const out = await listBillingConfig(ctx(["workflows.billing:view"]));
    expect(out[0].contractAmount).toBe(1675080000);
    expect(typeof out[0].contractAmount).toBe("number");
    expect(out[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it("OWNER는 권한키 없이도 통과", async () => {
    r.findAllBillingConfig.mockResolvedValue([]);
    await expect(listBillingConfig(ctx([], true))).resolves.toEqual([]);
  });
  it("get: 없으면 null(라우트 404)", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    expect(await getBillingConfig(ctx(["workflows.billing:view"]), 2099)).toBeNull();
  });
  it("create: configure 없으면 Forbidden", async () => {
    await expect(createBillingConfig(ctx(["workflows.billing:view"]), { year: 2026 } as never)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("create: year 중복이면 Conflict(409)", async () => {
    r.findBillingConfigByYear.mockResolvedValue(row);
    await expect(
      createBillingConfig(ctx(["workflows.billing:configure"]), { year: 2026 } as never),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(r.createBillingConfig).not.toHaveBeenCalled();
  });
  it("create: 정상 → DTO", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    r.createBillingConfig.mockResolvedValue(row);
    const out = await createBillingConfig(ctx(["workflows.billing:configure"]), { year: 2026 } as never);
    expect(out.year).toBe(2026);
    expect(out.monthlyAmount).toBe(139590000);
  });
  it("update: 없으면 null", async () => {
    r.findBillingConfigByYear.mockResolvedValue(null);
    expect(await updateBillingConfig(ctx(["workflows.billing:configure"]), 2099, {})).toBeNull();
    expect(r.updateBillingConfigByYear).not.toHaveBeenCalled();
  });
  it("remove: 없으면 false, 있으면 true + 연쇄 삭제 호출", async () => {
    r.findBillingConfigByYear.mockResolvedValueOnce(null);
    expect(await removeBillingConfig(ctx(["workflows.billing:configure"]), 2099)).toBe(false);
    r.findBillingConfigByYear.mockResolvedValueOnce(row);
    expect(await removeBillingConfig(ctx(["workflows.billing:configure"]), 2026)).toBe(true);
    expect(r.deleteBillingConfigByYear).toHaveBeenCalledWith(2026);
  });
  it("round: view로 목록, configure로 저장/삭제", async () => {
    r.findRoundDatesByYear.mockResolvedValue([{ id: "rd1", year: 2026, round: 2, submitDate: new Date("2026-03-10T00:00:00Z") }]);
    const list = await listRoundDates(ctx(["workflows.billing:view"]), 2026);
    expect(list[0]).toEqual({ round: 2, submitDate: "2026-03-10T00:00:00.000Z" });
    await expect(saveRoundDate(ctx(["workflows.billing:view"]), 2026, 2, new Date())).rejects.toBeInstanceOf(ForbiddenError);
    r.upsertRoundDate.mockResolvedValue({ id: "rd1", year: 2026, round: 2, submitDate: new Date("2026-03-11T00:00:00Z") });
    const saved = await saveRoundDate(ctx(["workflows.billing:configure"]), 2026, 2, new Date("2026-03-11T00:00:00Z"));
    expect(saved.round).toBe(2);
  });
});
