export interface GroupDef {
  key: string;
  label: string;
}
export interface PermissionLite {
  id: string;
  resource: string;
  action: string;
}
export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionLite[];
}

// permissions를 resource 첫 세그먼트(`.` 앞)로 묶어 groups 순서대로 반환한다.
// - 빈 그룹은 제외. - groups에 없는 세그먼트는 말미에 자체 그룹(label=세그먼트)으로 덧붙여 누락을 방지.
// - 그룹 내부는 입력 순서를 유지(호출부가 resource·action 정렬된 목록을 넘긴다).
export function groupPermissions(
  permissions: PermissionLite[],
  groups: readonly GroupDef[],
): PermissionGroup[] {
  const segOf = (resource: string) => resource.split(".")[0];
  const byKey = new Map<string, PermissionLite[]>();
  const seenOrder: string[] = [];
  for (const p of permissions) {
    const k = segOf(p.resource);
    if (!byKey.has(k)) {
      byKey.set(k, []);
      seenOrder.push(k);
    }
    byKey.get(k)!.push(p);
  }
  const defined = new Set(groups.map((g) => g.key));
  const result: PermissionGroup[] = [];
  // 1) 정의된 그룹 순서대로(존재하는 것만)
  for (const g of groups) {
    const perms = byKey.get(g.key);
    if (perms && perms.length) result.push({ key: g.key, label: g.label, permissions: perms });
  }
  // 2) 정의에 없는 세그먼트는 등장 순서대로 말미에(label=키)
  for (const k of seenOrder) {
    if (!defined.has(k)) result.push({ key: k, label: k, permissions: byKey.get(k)! });
  }
  return result;
}
