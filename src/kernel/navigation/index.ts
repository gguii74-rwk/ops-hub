import { prisma } from "@/lib/prisma";

export interface NavNode {
  key: string;
  label: string;
  href: string | null;
}

/** 활성 최상위 메뉴를 허용 키로 필터해 정렬 반환. requiredPermission이 없으면 공개. */
export async function loadNavigation(allowedKeys: string[]): Promise<NavNode[]> {
  const items = await prisma.navigationItem.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      key: true,
      label: true,
      href: true,
      requiredPermission: { select: { resource: true, action: true } },
    },
  });
  const allowed = new Set(allowedKeys);
  return items
    .filter((item) => {
      if (!item.requiredPermission) return true;
      return allowed.has(`${item.requiredPermission.resource}:${item.requiredPermission.action}`);
    })
    .map((item) => ({ key: item.key, label: item.label, href: item.href }));
}
