import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchHolidays } from "@/lib/integrations/holidays";

const okJson = (items: unknown) => ({ ok: true, json: async () => ({ response: { body: { items } } }) });

beforeEach(() => { process.env.DATA_GO_KR_SERVICE_KEY = "test-key"; });
afterEach(() => { vi.restoreAllMocks(); });

describe("fetchHolidays", () => {
  it("isHoliday=Y만, locdate→YYYY-MM-DD, 중복 제거", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("solMonth=01")) return okJson({ item: [
        { locdate: 20260101, dateName: "신정", isHoliday: "Y" },
        { locdate: 20260102, dateName: "평일(테스트)", isHoliday: "N" },
      ] }) as Response;
      if (url.includes("solMonth=03")) return okJson({ item: { locdate: 20260301, dateName: "삼일절", isHoliday: "Y" } }) as Response; // 단일 객체
      return okJson("") as Response; // 빈 달
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchHolidays(2026);
    expect(res).toContainEqual({ date: "2026-01-01", name: "신정" });
    expect(res).toContainEqual({ date: "2026-03-01", name: "삼일절" });
    expect(res.find((h) => h.date === "2026-01-02")).toBeUndefined(); // isHoliday N 제외
    expect(fetchMock).toHaveBeenCalledTimes(12); // 월별 호출
  });

  it("키 없으면 throw", async () => {
    delete process.env.DATA_GO_KR_SERVICE_KEY;
    await expect(fetchHolidays(2026)).rejects.toThrow();
  });
});
