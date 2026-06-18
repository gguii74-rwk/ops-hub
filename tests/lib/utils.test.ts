import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("공백으로 클래스를 합친다", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("충돌하는 tailwind 클래스는 뒤가 이긴다", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("falsy/조건 값은 무시한다", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
