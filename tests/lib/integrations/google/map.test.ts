import { describe, it, expect, vi } from "vitest";
import { normalizeGoogleEvent, collectAllPages, type GoogleRawEvent } from "@/lib/integrations/google/map";

describe("normalizeGoogleEvent", () => {
  it("all-day: date(시작) ~ date(종료, 배타) → 반열림 KST 경계, allDay true", () => {
    const n = normalizeGoogleEvent({
      id: "g1",
      summary: "여름 휴가",
      description: null,
      start: { date: "2026-06-19" },
      end: { date: "2026-06-20" }, // Google all-day 종료는 배타(다음날)
    });
    expect(n.allDay).toBe(true);
    expect(n.start.toISOString()).toBe("2026-06-18T15:00:00.000Z"); // 06-19 00:00 KST
    expect(n.end.toISOString()).toBe("2026-06-19T15:00:00.000Z"); // 06-20 00:00 KST
    expect(n.summary).toBe("여름 휴가");
  });

  it("timed: dateTime → 절대시각, allDay false", () => {
    const n = normalizeGoogleEvent({
      id: "g2",
      summary: "회의",
      description: "주간",
      start: { dateTime: "2026-06-19T10:00:00+09:00" },
      end: { dateTime: "2026-06-19T11:00:00+09:00" },
    });
    expect(n.allDay).toBe(false);
    expect(n.start.toISOString()).toBe("2026-06-19T01:00:00.000Z");
    expect(n.end.toISOString()).toBe("2026-06-19T02:00:00.000Z");
  });

  it("summary 없으면 null 보존(제목 결정은 module이)", () => {
    const n = normalizeGoogleEvent({ id: "g3", summary: null, description: null, start: { date: "2026-06-19" }, end: { date: "2026-06-20" } });
    expect(n.summary).toBeNull();
    expect(n.id).toBe("g3");
  });
});

describe("collectAllPages", () => {
  const ev = (id: string): GoogleRawEvent => ({ id, summary: id, description: null, start: { date: "2026-06-19" }, end: { date: "2026-06-20" } });

  it("nextPageToken을 따라 모든 페이지 누적(2500건 초과 누락 방지)", async () => {
    const pages: Record<string, { items: any[]; nextPageToken?: string }> = {
      "": { items: [ev("a"), ev("b")], nextPageToken: "p2" },
      p2: { items: [ev("c")], nextPageToken: "p3" },
      p3: { items: [ev("d")] }, // 토큰 없음 → 종료
    };
    const calls: (string | undefined)[] = [];
    const out = await collectAllPages(async (t) => {
      calls.push(t);
      return pages[t ?? ""];
    });
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(calls).toEqual([undefined, "p2", "p3"]);
  });

  it("단일 페이지(토큰 없음) → 한 번만 호출", async () => {
    const fetchPage = vi.fn(async () => ({ items: [ev("only")] }));
    const out = await collectAllPages(fetchPage);
    expect(out.map((e) => e.id)).toEqual(["only"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
