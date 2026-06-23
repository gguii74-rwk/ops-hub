import { describe, it, expect } from "vitest";
import { approveSchema } from "@/modules/admin/users/validations";

describe("approveSchema — NF2 name/teamId guard", () => {
  it("name·teamId 없이도 파싱된다(기존 호출 호환)", () => {
    const result = approveSchema.parse({ employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [] });
    expect(result.employmentType).toBe("REGULAR");
    expect(result.name).toBeUndefined();
    expect(result.teamId).toBeUndefined();
  });
  it("name·teamId 포함 시 파싱되어 반환한다(NF2 승인이 권위)", () => {
    const result = approveSchema.parse({
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [],
      name: "홍길동", teamId: "team-abc",
    });
    expect(result.name).toBe("홍길동");
    expect(result.teamId).toBe("team-abc");
  });
  it("teamId=null 허용(무소속 명시)", () => {
    const result = approveSchema.parse({
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [],
      name: "김철수", teamId: null,
    });
    expect(result.teamId).toBeNull();
  });
});
