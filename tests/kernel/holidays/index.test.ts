import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, count, upsert, $transaction, fetchHolidays } = vi.hoisted(() => {
  const findMany = vi.fn();
  const count = vi.fn();
  const upsert = vi.fn();
  const $transaction = vi.fn(async (cb: (tx: { holiday: { upsert: typeof upsert } }) => unknown) => cb({ holiday: { upsert } }));
  const fetchHolidays = vi.fn();
  return { findMany, count, upsert, $transaction, fetchHolidays };
});

vi.mock("@/lib/prisma", () => ({ prisma: { holiday: { findMany, count }, $transaction } }));
vi.mock("@/lib/integrations/holidays", () => ({ fetchHolidays }));

import { getHolidaysInRange, ensureYearsSynced, syncHolidaysForYear, getUnsyncedYears } from "@/kernel/holidays";

beforeEach(() => vi.clearAllMocks());

describe("getHolidaysInRange", () => {
  it("범위 공휴일을 YYYY-MM-DD Set으로", async () => {
    findMany.mockResolvedValue([{ date: new Date("2026-08-15T00:00:00.000Z") }]);
    const set = await getHolidaysInRange(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T00:00:00Z"));
    expect(set.has("2026-08-15")).toBe(true);
  });
});

describe("syncHolidaysForYear", () => {
  it("fetch 결과를 단일 트랜잭션으로 upsert", async () => {
    fetchHolidays.mockResolvedValue([{ date: "2026-01-01", name: "신정" }]);
    const n = await syncHolidaysForYear(2026);
    expect(n).toBe(1);
    expect($transaction).toHaveBeenCalledTimes(1); // 연도 전량을 한 트랜잭션으로(부분 적재 방지)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: new Date("2026-01-01T00:00:00.000Z") },
    }));
  });
  it("트랜잭션 실패는 전파(부분 적재 없이 롤백 → 다음 ensure에서 재시도)", async () => {
    fetchHolidays.mockResolvedValue([{ date: "2026-01-01", name: "신정" }]);
    $transaction.mockRejectedValueOnce(new Error("tx fail"));
    await expect(syncHolidaysForYear(2026)).rejects.toThrow();
  });
});

describe("ensureYearsSynced", () => {
  it("미적재(count=0)면 sync, 적재됐으면 skip", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
    fetchHolidays.mockResolvedValue([{ date: "2027-01-01", name: "신정" }]);
    await ensureYearsSynced([2027, 2026]);
    expect(fetchHolidays).toHaveBeenCalledTimes(1);
    expect(fetchHolidays).toHaveBeenCalledWith(2027);
  });
  it("sync 실패는 throw하지 않음(로그 후 진행)", async () => {
    count.mockResolvedValue(0);
    fetchHolidays.mockRejectedValue(new Error("API down"));
    await expect(ensureYearsSynced([2027])).resolves.toBeUndefined();
  });
});

describe("getUnsyncedYears", () => {
  it("미적재(count=0) 연도만 반환", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
    expect(await getUnsyncedYears([2030, 2026])).toEqual([2030]);
  });
});
