import { describe, it, expect } from "vitest";
import { teamStats } from "@/app/(app)/admin/teams/_components/teams-editor";

const T = (over: Partial<{ id: string; name: string; leadUserId: string | null; active: boolean; memberCount: number; updatedAt: string }>) =>
  ({ id: "t", name: "n", leadUserId: null, active: true, memberCount: 0, updatedAt: "2026-01-01T00:00:00.000Z", ...over });

describe("teamStats", () => {
  it("counts teams, sums members, counts assigned leads", () => {
    const s = teamStats([
      T({ id: "a", memberCount: 8, leadUserId: "u1" }),
      T({ id: "b", memberCount: 3, leadUserId: null }),
      T({ id: "c", memberCount: 5, leadUserId: "u2" }),
    ]);
    expect(s).toEqual({ count: 3, members: 16, led: 2 });
  });
  it("handles empty list", () => {
    expect(teamStats([])).toEqual({ count: 0, members: 0, led: 0 });
  });
});
