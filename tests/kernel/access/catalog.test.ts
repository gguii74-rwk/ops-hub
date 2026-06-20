import { describe, it, expect } from "vitest";
import { RESOURCES } from "@/kernel/access/catalog";

describe("access catalog — leave 관리자 권한 resource", () => {
  it("leave.status·leave.admin resource가 카탈로그에 있다(=> :view 자동 seed)", () => {
    expect(RESOURCES).toContain("leave.status");
    expect(RESOURCES).toContain("leave.admin");
  });
  it("기존 leave resource를 보존한다", () => {
    expect(RESOURCES).toContain("leave.request");
    expect(RESOURCES).toContain("leave.approval");
    expect(RESOURCES).toContain("leave.allocation");
  });
});
