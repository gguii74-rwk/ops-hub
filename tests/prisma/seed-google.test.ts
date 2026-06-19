import { describe, it, expect } from "vitest";
import { resolveGoogleOwnerId, googleSourceKey } from "../../prisma/seed-google";

describe("resolveGoogleOwnerId", () => {
  const userIdByEmail = { "u9@corp.com": "user-9" };

  it("owner-map에 매핑된 calId → 해당 userId", () => {
    expect(resolveGoogleOwnerId("cal-9@group", { "cal-9@group": "u9@corp.com" }, userIdByEmail)).toBe("user-9");
  });

  it("owner-map에 없는 calId → null(공유/팀)", () => {
    expect(resolveGoogleOwnerId("team@group", {}, userIdByEmail)).toBeNull();
  });

  it("매핑된 이메일에 해당 User 없음 → null(고착 방지)", () => {
    expect(resolveGoogleOwnerId("cal-x@group", { "cal-x@group": "ghost@corp.com" }, userIdByEmail)).toBeNull();
  });
});

describe("googleSourceKey (HMAC — 비가역 불투명 식별자)", () => {
  const secret = "test-source-key-secret-0123456789";

  it("calId(이메일 형태)를 key에 노출하지 않는다(§9 — 불투명 식별자)", () => {
    const key = googleSourceKey("person@example.com", secret);
    expect(key).not.toContain("person@example.com");
    expect(key).not.toContain("@");
    expect(key.startsWith("google:")).toBe(true);
  });

  it("같은 calId+secret → 같은 key(재시드 upsert 멱등)", () => {
    expect(googleSourceKey("cal-a@group", secret)).toBe(googleSourceKey("cal-a@group", secret));
  });

  it("다른 calId(같은 secret) → 다른 key(충돌 방지)", () => {
    expect(googleSourceKey("cal-a@group", secret)).not.toBe(googleSourceKey("cal-b@group", secret));
  });

  it("secret이 다르면 같은 calId라도 key가 다르다(secret 없이는 calId→key 역산 불가)", () => {
    expect(googleSourceKey("cal-a@group", secret)).not.toBe(googleSourceKey("cal-a@group", "other-secret-9876543210abcdef"));
  });

  it("secret 없으면 throw(무염 결정적 해시로의 조용한 폴백 차단)", () => {
    expect(() => googleSourceKey("cal-a@group", "")).toThrow();
  });
});
