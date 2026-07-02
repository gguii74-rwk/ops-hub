import { describe, it, expect } from "vitest";
import { ROLE_ALLOW, type Cell } from "../../prisma/seed-roles";
import { KIND_RESOURCE } from "../../src/modules/workflows/policy";

const KIND_VIEW_KEYS = Object.values(KIND_RESOURCE).map((r) => `${r}:view`);
const has = (cells: Cell[], key: string) => cells.some((c) => (Array.isArray(c) ? c[0] === key : c === key));
const hasStar = (cells: Cell[]) => cells.includes("*");

describe("ROLE_ALLOW — workflows:view 집계 동반(D13, fresh 패리티)", () => {
  it("임의 kind view 보유 role은 workflows:view도 보유", () => {
    for (const [role, cells] of Object.entries(ROLE_ALLOW)) {
      if (hasStar(cells)) continue; // "*"는 전부(pm)
      if (KIND_VIEW_KEYS.some((k) => has(cells, k))) {
        expect(has(cells, "workflows:view"), `${role}에 workflows:view 필요`).toBe(true);
      }
    }
  });

  it("regular/contractor-developer/contractor-content는 client kind view 보유", () => {
    for (const role of ["regular-developer", "contractor-developer", "contractor-content"]) {
      expect(has(ROLE_ALLOW[role], "workflows.weeklyClient:view")).toBe(true);
      expect(has(ROLE_ALLOW[role], "workflows.monthlyClient:view")).toBe(true);
    }
  });

  it("contractor-civil-response는 workflows:view 보유(메뉴 노출), client view는 없음", () => {
    expect(has(ROLE_ALLOW["contractor-civil-response"], "workflows:view")).toBe(true);
    expect(has(ROLE_ALLOW["contractor-civil-response"], "workflows.weeklyClient:view")).toBe(false);
  });

  it("위임 admin은 workflows 권한 0(workflows:view 미보유)", () => {
    expect(has(ROLE_ALLOW.admin, "workflows:view")).toBe(false);
  });
});
