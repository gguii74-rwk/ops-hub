import { describe, it, expect } from "vitest";
import { groupPermissions } from "@/app/(app)/admin/roles/_components/grouping";

const GROUPS = [
  { key: "dashboard", label: "대시보드" },
  { key: "calendar", label: "캘린더" },
  { key: "workflows", label: "업무" },
  { key: "leave", label: "연차" },
  { key: "admin", label: "관리" },
  { key: "integrations", label: "연동" },
];

describe("groupPermissions", () => {
  it("첫 세그먼트로 묶고 groups 순서대로 반환", () => {
    const perms = [
      { id: "1", resource: "admin.users", action: "view" },
      { id: "2", resource: "calendar.work", action: "view" },
      { id: "3", resource: "dashboard", action: "view" },
      { id: "4", resource: "calendar.leave", action: "view" },
    ];
    const out = groupPermissions(perms, GROUPS);
    expect(out.map((g) => g.key)).toEqual(["dashboard", "calendar", "admin"]);
    const cal = out.find((g) => g.key === "calendar")!;
    expect(cal.permissions.map((p) => p.id)).toEqual(["2", "4"]); // 입력 순서 유지
    expect(cal.label).toBe("캘린더");
  });

  it("빈 그룹은 제외한다", () => {
    const out = groupPermissions([{ id: "1", resource: "leave.request", action: "view" }], GROUPS);
    expect(out.map((g) => g.key)).toEqual(["leave"]);
  });

  it("정의에 없는 세그먼트는 말미에 자체 그룹(label=세그먼트)", () => {
    const out = groupPermissions(
      [
        { id: "1", resource: "admin.users", action: "view" },
        { id: "2", resource: "mystery.thing", action: "view" },
      ],
      GROUPS,
    );
    expect(out.map((g) => g.key)).toEqual(["admin", "mystery"]);
    expect(out.find((g) => g.key === "mystery")!.label).toBe("mystery");
  });
});
