import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    accessRole: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getMatrix } from "@/modules/admin/roles/repositories";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([]);
});

describe("getMatrix 역할 표시 순서(D1)", () => {
  it("DB가 임의 순서로 줘도 ROLE_DISPLAY_ORDER 순서로 반환", async () => {
    h.db.accessRole.findMany.mockResolvedValue([
      { id: "1", key: "pm", name: "PM" },
      { id: "2", key: "contractor-civil-response", name: "민원응대" },
      { id: "3", key: "admin", name: "관리자" },
      { id: "4", key: "regular-developer", name: "정규 개발자" },
      { id: "5", key: "contractor-content", name: "콘텐츠관리" },
      { id: "6", key: "contractor-developer", name: "외주 개발자" },
    ]);
    const m = await getMatrix();
    expect(m.roles.map((r) => r.key)).toEqual([
      "admin", "pm", "regular-developer",
      "contractor-developer", "contractor-content", "contractor-civil-response",
    ]);
  });

  it("미지의 키는 말미로(안정 정렬)", async () => {
    h.db.accessRole.findMany.mockResolvedValue([
      { id: "x", key: "mystery", name: "?" },
      { id: "1", key: "pm", name: "PM" },
      { id: "3", key: "admin", name: "관리자" },
    ]);
    const m = await getMatrix();
    expect(m.roles.map((r) => r.key)).toEqual(["admin", "pm", "mystery"]);
  });
});
