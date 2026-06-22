import { describe, it, expect } from "vitest";
import { approveSchema } from "@/modules/admin/users/validations";

describe("approveSchema — NF2 name/department guard", () => {
  it("name·department 없이도 파싱된다(기존 호출 호환)", () => {
    const result = approveSchema.parse({ employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [] });
    expect(result.employmentType).toBe("REGULAR");
    expect(result.name).toBeUndefined();
    expect(result.department).toBeUndefined();
  });
  it("name·department 포함 시 파싱되어 반환한다(NF2 승인이 권위)", () => {
    const result = approveSchema.parse({
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [],
      name: "홍길동", department: "플랫폼팀",
    });
    expect(result.name).toBe("홍길동");
    expect(result.department).toBe("플랫폼팀");
  });
  it("department=null 허용(부서 없음 명시)", () => {
    const result = approveSchema.parse({
      employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [],
      name: "김철수", department: null,
    });
    expect(result.department).toBeNull();
  });
});
