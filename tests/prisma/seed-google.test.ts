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

describe("googleSourceKey", () => {
  it("calId(이메일 형태)를 key에 노출하지 않는다(§9 — 불투명 식별자)", () => {
    const key = googleSourceKey("person@example.com");
    expect(key).not.toContain("person@example.com");
    expect(key).not.toContain("@");
    expect(key.startsWith("google:")).toBe(true);
  });

  it("같은 calId → 같은 key(결정적 — 재시드 upsert 멱등)", () => {
    expect(googleSourceKey("cal-a@group")).toBe(googleSourceKey("cal-a@group"));
  });

  it("다른 calId → 다른 key(충돌 방지)", () => {
    expect(googleSourceKey("cal-a@group")).not.toBe(googleSourceKey("cal-b@group"));
  });
});
