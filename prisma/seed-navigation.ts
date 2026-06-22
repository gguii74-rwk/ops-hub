// 메뉴 트리 부트스트랩 로직(seed.ts에서 추출 — planGoogleSources 패턴). DB 미접속 단위테스트 가능.
// 상대경로 import: tsx의 @ alias 해석 의존 회피(seed.ts 관행).
import type { NavEntry } from "../src/kernel/access/catalog";

// seedNavigation이 호출하는 클라이언트 표면(구조적 최소). 실 PrismaClient·테스트 mock 둘 다 충족.
export interface NavWriteClient {
  navigationItem: {
    findUnique(args: { where: { key: string }; select: { id: true; parentId: true } }): Promise<{ id: string; parentId: string | null } | null>;
    create(args: {
      data: {
        key: string; label: string; href: string; sortOrder: number;
        parentId: string | null; requiredPermissionId: string;
      };
    }): Promise<{ id: string }>;
  };
}

// create-if-absent. key 존재 시 skip(편집 보존 — D3), 없으면 NAV 값으로 create.
// 권한 미해석이면 throw(fail-closed — 공개 누출 방지 — D3/E3). 부모를 먼저 만들고 그 id로
// 자식 parentId를 연결한다(부모가 이미 있어도 자식 재귀는 돈다 → 기존 환경에 신규 자식만 추가).
// sortOrder는 형제 내 (idx+1)*10.
export async function seedNavigation(
  client: NavWriteClient,
  entries: readonly NavEntry[],
  resolvePermissionId: (permissionKey: string) => Promise<string | null>,
  parentId: string | null = null,
): Promise<void> {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let id: string;
    const existing = await client.navigationItem.findUnique({ where: { key: entry.key }, select: { id: true, parentId: true } });
    if (existing) {
      id = existing.id; // 편집 보존: 어떤 필드도 갱신하지 않는다.
      // P7: 자식을 가질 부트스트랩 부모가 그 사이 reparent돼 top-level이 아니게 됐으면, 그 아래 자식 생성은
      // depth-3 위반이다(읽기·관리 경로는 2단만 처리). fail-closed로 중단(부분 부팅으로 트리 손상 방지).
      if (entry.children?.length && existing.parentId !== null) {
        throw new Error(
          `부트스트랩 부모 '${entry.key}'가 더 이상 top-level이 아님(parentId=${existing.parentId}) — 자식 생성 시 depth-2 위반. 중단.`,
        );
      }
    } else {
      const permissionId = await resolvePermissionId(entry.permission);
      if (!permissionId) {
        throw new Error(
          `nav '${entry.key}'의 권한 '${entry.permission}'을 해석하지 못함 — 중단(메뉴가 공개로 새는 것 방지).`,
        );
      }
      const created = await client.navigationItem.create({
        data: {
          key: entry.key, label: entry.label, href: entry.href,
          sortOrder: (i + 1) * 10, parentId, requiredPermissionId: permissionId,
        },
      });
      id = created.id;
    }
    if (entry.children?.length) {
      await seedNavigation(client, entry.children, resolvePermissionId, id);
    }
  }
}
