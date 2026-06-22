import { prisma } from "@/lib/prisma";

// 클라이언트(AppNav) 계약 — 권한 필터는 서버에서 끝났으므로 권한 정보를 넘기지 않는다(SC-2).
export interface NavNode {
  key: string;
  label: string;
  href: string | null;
  children: NavNode[];
}

// 로드된 트리(권한키 포함, 가시성 판정용). isActive는 쿼리에서 이미 필터됨.
export interface RawNavLeaf {
  key: string;
  label: string;
  href: string | null;
  sortOrder: number;
  requiredPermission: { resource: string; action: string } | null;
}
export interface RawNavParent extends RawNavLeaf {
  children: RawNavLeaf[];
}

// 관용 가시성(D4): 부모는 (자체 권한 통과) OR (보이는 자식 ≥ 1)이면 노출. 자식은 leaf(2단 — D6).
// 공개(requiredPermission == null)는 항상 통과(D8). 부모·자식 모두 sortOrder로 정렬.
export function selectVisibleNav(parents: RawNavParent[], allowedKeys: Set<string>): NavNode[] {
  const ownAllowed = (n: RawNavLeaf): boolean =>
    n.requiredPermission == null ||
    allowedKeys.has(`${n.requiredPermission.resource}:${n.requiredPermission.action}`);

  return parents
    .map((p) => {
      const children: NavNode[] = [...p.children]
        .filter(ownAllowed)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ key: c.key, label: c.label, href: c.href, children: [] as NavNode[] }));
      return { p, children };
    })
    .filter(({ p, children }) => ownAllowed(p) || children.length > 0)
    .sort((a, b) => a.p.sortOrder - b.p.sortOrder)
    // D5 인코딩: 자체 권한 통과 시에만 href를 링크로 유지, 관용으로만 노출되는 부모는 href=null(그룹 토글).
    .map(({ p, children }) => ({ key: p.key, label: p.label, href: ownAllowed(p) ? p.href : null, children }));
}

// 활성 2단 트리를 로드해 허용 키로 필터(관용)·정렬 반환.
export async function loadNavigation(allowedKeys: string[]): Promise<NavNode[]> {
  const items = await prisma.navigationItem.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      key: true,
      label: true,
      href: true,
      sortOrder: true,
      requiredPermission: { select: { resource: true, action: true } },
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          key: true,
          label: true,
          href: true,
          sortOrder: true,
          requiredPermission: { select: { resource: true, action: true } },
        },
      },
    },
  });
  return selectVisibleNav(items as RawNavParent[], new Set(allowedKeys));
}
