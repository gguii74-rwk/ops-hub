import { describe, it, expect } from "vitest";
import { createNavSchema, updateNavSchema, reorderNavSchema, deleteNavBodySchema, updateNavBodySchema, reparentNavSchema, reparentNavBodySchema } from "@/modules/admin/navigation/validations";
import { HREF_PATTERN, isKnownInternalRoute } from "@/modules/admin/navigation/href";

const hrefOk = (h: string) => HREF_PATTERN.test(h);

describe("href 검증(D7/F-1)", () => {
  it("외부·오픈리다이렉트·형식위반 거부", () => {
    for (const bad of ["//host", "//evilexample", "http://x", "/\\x", "/a b", "/a\\b", "/a%2Fb", ""]) {
      expect(hrefOk(bad)).toBe(false);
    }
  });
  it("origin-relative 내부 경로 통과", () => {
    for (const ok of ["/valid/path", "/admin/navigation", "/dashboard"]) {
      expect(hrefOk(ok)).toBe(true);
    }
  });
});

describe("isKnownInternalRoute(소프트 경고)", () => {
  it("알려진 prefix는 true, 그 외 false", () => {
    expect(isKnownInternalRoute("/admin/navigation")).toBe(true);
    expect(isKnownInternalRoute("/leave")).toBe(true);
    expect(isKnownInternalRoute("/unknown/page")).toBe(false);
  });
});

describe("createNavSchema", () => {
  it("label 필수·공개(권한 null)·그룹헤더(href null) 허용", () => {
    expect(createNavSchema.safeParse({ label: "메뉴", href: null, parentId: null, requiredPermissionId: null }).success).toBe(true);
  });
  it("빈 label·외부 href 거부", () => {
    expect(createNavSchema.safeParse({ label: "", href: "/x", parentId: null, requiredPermissionId: null }).success).toBe(false);
    expect(createNavSchema.safeParse({ label: "메뉴", href: "//evil", parentId: null, requiredPermissionId: null }).success).toBe(false);
  });
  it("key 필드는 스키마가 strip(입력 불가 — D17)", () => {
    const parsed = createNavSchema.parse({ label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null, key: "해킹" });
    expect(parsed).not.toHaveProperty("key");
  });
});

describe("updateNavSchema", () => {
  it("parentId는 strip(이동은 reparent 전용)", () => {
    const parsed = updateNavSchema.parse({ label: "x", parentId: "p1" });
    expect(parsed).not.toHaveProperty("parentId");
  });
});

describe("reorderNavSchema", () => {
  const AT = "2026-06-22T00:00:00.000Z";
  it("parentId(null 허용)+orderedItems(최소 1, id+updatedAt)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a", updatedAt: AT }, { id: "b", updatedAt: AT }] }).success).toBe(true);
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [] }).success).toBe(false);
  });
  it("updatedAt 없는 항목 거부(P6 — 버전 토큰 필수)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a" }] }).success).toBe(false);
  });
  it("중복 ID 거부(P2 — sortOrder 손상 차단)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a", updatedAt: AT }, { id: "a", updatedAt: AT }] }).success).toBe(false);
  });
});

describe("deleteNavBodySchema(P9 — 확인 자식 집합 동반)", () => {
  const AT = "2026-06-22T00:00:00.000Z";
  it("updatedAt + confirmedChildIds(빈 배열=leaf·ID 배열 모두 허용)", () => {
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT, confirmedChildIds: [] }).success).toBe(true);
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT, confirmedChildIds: ["c1", "c2"] }).success).toBe(true);
  });
  it("confirmedChildIds 누락 거부(fail-closed — TOCTOU 가드 우회 차단)", () => {
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT }).success).toBe(false);
  });
});

describe("SC-7 낙관락 body 스키마", () => {
  const AT = "2026-06-22T00:00:00.000Z";

  describe("updateNavBodySchema(수정 + updatedAt)", () => {
    it("updatedAt + label로 성공", () => {
      expect(updateNavBodySchema.safeParse({ updatedAt: AT, label: "메뉴" }).success).toBe(true);
    });
    it("updatedAt 누락 시 실패(낙관락 필수)", () => {
      expect(updateNavBodySchema.safeParse({ label: "메뉴" }).success).toBe(false);
    });
    it("부분 필드(href, requiredPermissionId, isActive) 함께 통과", () => {
      expect(updateNavBodySchema.safeParse({
        updatedAt: AT,
        label: "메뉴",
        href: "/admin/navigation",
        requiredPermissionId: "p1",
        isActive: false
      }).success).toBe(true);
    });
  });

  describe("reparentNavBodySchema(이동 + updatedAt)", () => {
    it("updatedAt + newParentId(null 허용)로 성공", () => {
      expect(reparentNavBodySchema.safeParse({ updatedAt: AT, newParentId: null }).success).toBe(true);
    });
    it("updatedAt + newParentId(유효한 id)로 성공", () => {
      expect(reparentNavBodySchema.safeParse({ updatedAt: AT, newParentId: "p1" }).success).toBe(true);
    });
    it("updatedAt 누락 시 실패(낙관락 필수)", () => {
      expect(reparentNavBodySchema.safeParse({ newParentId: null }).success).toBe(false);
    });
  });

  describe("reparentNavSchema(이동 스키마 — updatedAt 제외)", () => {
    it("newParentId(null = 승격)로 성공", () => {
      expect(reparentNavSchema.safeParse({ newParentId: null }).success).toBe(true);
    });
    it("newParentId(유효한 id)로 성공", () => {
      expect(reparentNavSchema.safeParse({ newParentId: "p1" }).success).toBe(true);
    });
    it("newParentId(빈 문자열)은 거부(.min(1))", () => {
      expect(reparentNavSchema.safeParse({ newParentId: "" }).success).toBe(false);
    });
  });
});
