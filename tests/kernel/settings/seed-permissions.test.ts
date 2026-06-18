import { describe, it, expect } from "vitest";
import { RESOURCES } from "@/kernel/access/catalog";
import { CATALOG } from "@/kernel/settings/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";

// seed가 만드는 권한 키 집합 재구성: 모든 RESOURCES:view + EXTRA_PERMISSIONS.
function seededKeys(): Set<string> {
  const s = new Set<string>();
  for (const r of RESOURCES) s.add(`${r}:view`);
  for (const [resource, action] of EXTRA_PERMISSIONS) s.add(`${resource}:${action}`);
  return s;
}

describe("settings 카탈로그 권한이 seed에 존재", () => {
  it("모든 카탈로그 permission(resource:action)이 seed 권한 집합에 포함", () => {
    const seeded = seededKeys();
    const missing = CATALOG.map((e) => `${e.permission.resource}:${e.permission.action}`).filter(
      (k) => !seeded.has(k),
    );
    expect(missing).toEqual([]);
  });

  it("workflows configure 권한이 명시적으로 추가됨", () => {
    const keys = new Set(EXTRA_PERMISSIONS.map(([r, a]) => `${r}:${a}`));
    expect(keys.has("workflows.weekly:configure")).toBe(true);
    expect(keys.has("workflows.billing:configure")).toBe(true);
  });
});
