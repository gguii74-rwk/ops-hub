import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";

describe("token 유틸", () => {
  it("generateVerifyToken은 64-hex 평문 토큰을 만든다(randomBytes(32))", () => {
    const t = generateVerifyToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it("두 번 호출하면 서로 다른 토큰(엔트로피)", () => {
    expect(generateVerifyToken()).not.toBe(generateVerifyToken());
  });
  it("hashToken은 평문의 sha256 hex — DB엔 해시만 저장", () => {
    const plain = "deadbeef";
    expect(hashToken(plain)).toBe(createHash("sha256").update(plain).digest("hex"));
  });
  it("hashToken은 결정적(같은 입력 → 같은 해시)", () => {
    expect(hashToken("x")).toBe(hashToken("x"));
  });
});
