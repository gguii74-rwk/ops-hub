import { describe, expect, it } from "vitest";
import { issueClaims, toGroups } from "@/lib/auth/federation/claims";
import type { SessionUser } from "@/lib/auth/types";

const base: SessionUser = {
  id: "u1",
  email: "a@b.com",
  name: "A",
  systemRole: "MEMBER",
  employmentType: "REGULAR",
  jobFunction: "DEVELOPER",
};

describe("federation claims", () => {
  it("every authenticated user gets kgs-user", () => {
    expect(toGroups(base)).toEqual(["kgs-user"]);
  });

  it("OWNER/ADMIN gets ops-admin", () => {
    expect(toGroups({ ...base, systemRole: "OWNER" })).toContain("ops-admin");
    expect(toGroups({ ...base, systemRole: "ADMIN" })).toContain("ops-admin");
  });

  it("MANAGER gets ops-manager", () => {
    expect(toGroups({ ...base, systemRole: "MANAGER" })).toContain("ops-manager");
  });

  it("issueClaims exposes only sub/email/groups", () => {
    expect(issueClaims(base)).toEqual({ sub: "u1", email: "a@b.com", groups: ["kgs-user"] });
  });
});
