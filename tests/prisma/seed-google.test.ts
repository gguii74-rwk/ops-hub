import { describe, it, expect } from "vitest";
import { resolveGoogleOwnerId, googleSourceKey, planGoogleSources } from "../../prisma/seed-google";

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

describe("planGoogleSources (externalId 기준 조정 — secret 회전 시 중복 ACTIVE 방지)", () => {
  const secretA = "secret-aaaaaaaaaaaaaa";
  const secretB = "secret-bbbbbbbbbbbbbb";

  it("secret 회전: 같은 calId는 기존 행(externalId 매칭)을 update — 생성하지 않는다", () => {
    const existing = [{ id: "row-1", externalId: "cal-1@g" }];
    const plan = planGoogleSources(["cal-1@g"], existing, secretB, {}, {});
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].existingId).toBe("row-1"); // 새 행 생성이 아니라 기존 행 in-place 갱신
    expect(plan.upserts[0].key).toBe(googleSourceKey("cal-1@g", secretB)); // 새 secret으로 재키잉
    expect(plan.upserts[0].key).not.toBe(googleSourceKey("cal-1@g", secretA));
    expect(plan.deactivateIds).toEqual([]);
  });

  it("신규 calId → existingId null(생성 대상)", () => {
    const plan = planGoogleSources(["new@g"], [], secretA, {}, {});
    expect(plan.upserts[0].existingId).toBeNull();
    expect(plan.upserts[0].calId).toBe("new@g");
  });

  it("설정에서 빠진 calId의 기존 ACTIVE 행 → 비활성화 대상", () => {
    const existing = [
      { id: "row-keep", externalId: "keep@g" },
      { id: "row-gone", externalId: "gone@g" },
    ];
    const plan = planGoogleSources(["keep@g"], existing, secretA, {}, {});
    expect(plan.upserts.map((u) => u.existingId)).toEqual(["row-keep"]);
    expect(plan.deactivateIds).toEqual(["row-gone"]);
  });

  it("ownerUserId는 owner-map으로 해석돼 계획에 포함", () => {
    const plan = planGoogleSources(["cal-9@g"], [], secretA, { "cal-9@g": "u9@corp.com" }, { "u9@corp.com": "user-9" });
    expect(plan.upserts[0].ownerUserId).toBe("user-9");
  });
});
