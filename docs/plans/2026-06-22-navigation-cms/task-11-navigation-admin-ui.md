# task-11 — 관리 UI: 에디터·미리보기·탭·삭제 확인

**목적:** `/admin/navigation` 관리 화면을 구현한다. 서버 게이트(view), 트리 표시·추가/수정/삭제(cascade 확인)·순서변경·필요권한 선택(공개 명시 — D8)·역할 미리보기(D10)·결과 미리보기 패널(D13)·한계 안내(D15). 페이로드/경고/확인 로직은 순수 헬퍼로 추출해 테스트(이 저장소 컴포넌트 테스트 관행).

## Files

- **Create:** `src/app/(app)/admin/navigation/page.tsx`(서버 게이트 view)
- **Create:** `src/app/(app)/admin/navigation/_components/navigation-editor.tsx`(클라이언트 에디터 + 순수 헬퍼)
- **Modify:** `src/app/(app)/admin/_components/admin-tabs.tsx`(`메뉴 관리` 탭)
- **Create (test):** `tests/app/admin/navigation/payload.test.ts`

## Prep

- 스펙 §7(관리 UI)·결정 D8/D9/D10/D11/D13/D15/D17.
- 엔트리포인트 §Shared Contracts **SC-3**(권한키)·**SC-4**(`isKnownInternalRoute`)·**SC-6**(`NavigationNodeAdmin`)·**SC-7**(낙관락 — 변경 시 `updatedAt` 동반).
- 기존 출처: `src/app/(app)/admin/users/new/_components/create-user-form.tsx`(`useMutation`+`toXPayload` 순수 헬퍼+`router` 패턴), `src/app/(app)/admin/_components/admin-tabs.tsx`(탭·`useCan`), `src/app/(app)/admin/users/page.tsx`(서버 게이트), `src/components/ui`(`Card`/`Input`/`Label`/`Button`).

## Deps

task-06(`isKnownInternalRoute`), task-10(API).

## Cautions

- **공개는 명시 선택(D8):** 권한 select 기본은 "권한 선택"(미선택=저장 불가). 공개는 `"공개 — 로그인한 모든 사용자"` 옵션을 **명시 선택**해야 한다. 오타로 공개 흘리기 방지.
- **`key`는 UI에 입력 항목으로 두지 말 것(D17)** — 서버 생성. 폼에 key 필드 없음.
- **변경 요청에 `updatedAt` 동반(SC-7)** — 수정·삭제·이동은 그 행의 `updatedAt`(ISO)을 body에 넣는다. 빠지면 라우트 400/409.
- **삭제는 2단계 확인 + 자식 수를 가시 텍스트로(D11/P4):** 첫 클릭은 확인 진입만(즉시 삭제 금지 — edit-leave-modal 패턴). 확인 단계는 `deleteConfirmLabel(node)`("하위 N개 함께 삭제")를 **`title`(툴팁)이 아니라 화면에 보이는 텍스트**로 렌더하고, 최종 삭제 버튼은 그 확인 영역(`role="alertdialog"`) 안에 둔다. 툴팁에만 두면 터치·키보드·더블클릭에서 경고를 못 보고 서브트리를 삭제(데이터 손실).
- **한계 안내(D15):** "새 보호영역(새 권한)은 개발자 요청" 문구를 화면에 둔다.
- **순수 헬퍼만 테스트.** JSX/fetch는 이 저장소 관행상 단위테스트 안 함(헬퍼로 로직 추출).
- `Button`은 `asChild` 미지원 — 링크 버튼은 쓰지 않는다(여기선 버튼/폼만).

## Step 1 — 실패 테스트: 순수 헬퍼

`tests/app/admin/navigation/payload.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import {
  toCreatePayload, toUpdatePayload, hrefWarning, deleteConfirmLabel, PUBLIC_OPTION,
  type NavFormState,
} from "@/app/(app)/admin/navigation/_components/navigation-editor";

const base: NavFormState = { label: " 메뉴 ", href: "", parentId: "", permissionSelect: "" };

describe("toCreatePayload", () => {
  it("label trim, 빈 href·parentId·미선택권한 → null, 공개 옵션 → null", () => {
    expect(toCreatePayload({ ...base, permissionSelect: PUBLIC_OPTION })).toEqual({
      label: "메뉴", href: null, parentId: null, requiredPermissionId: null,
    });
  });
  it("href·parentId·permissionId 값은 그대로", () => {
    expect(toCreatePayload({ label: "자식", href: "/admin/x", parentId: "p1", permissionSelect: "perm9" })).toEqual({
      label: "자식", href: "/admin/x", parentId: "p1", requiredPermissionId: "perm9",
    });
  });
});

describe("toUpdatePayload", () => {
  it("updatedAt 포함, parentId 없음(이동은 reparent 전용)", () => {
    const p = toUpdatePayload({ ...base, label: "x", permissionSelect: "perm9" }, "2026-06-22T00:00:00.000Z");
    expect(p).toEqual({ label: "x", href: null, requiredPermissionId: "perm9", updatedAt: "2026-06-22T00:00:00.000Z" });
    expect(p).not.toHaveProperty("parentId");
  });
});

describe("hrefWarning(소프트 경고 — D7)", () => {
  it("빈 href·알려진 경로는 경고 없음, 미지 경로는 경고", () => {
    expect(hrefWarning("")).toBeNull();
    expect(hrefWarning("/admin/navigation")).toBeNull();
    expect(hrefWarning("/unknown")).toMatch(/내부 경로/);
  });
});

describe("deleteConfirmLabel(D11)", () => {
  it("자식 수에 따라 cascade 문구", () => {
    expect(deleteConfirmLabel({ label: "관리", children: [{}, {}] as never[] })).toMatch(/하위 메뉴 2개/);
    expect(deleteConfirmLabel({ label: "대시보드", children: [] })).not.toMatch(/하위/);
  });
});
```

실행: `npm test -- admin/navigation/payload` → **FAIL**.

## Step 2 — navigation-editor.tsx

`src/app/(app)/admin/navigation/_components/navigation-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { isKnownInternalRoute } from "@/modules/admin/navigation/href";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface NavRowDto {
  id: string;
  key: string;
  label: string;
  href: string | null;
  parentId: string | null;
  sortOrder: number;
  requiredPermissionId: string | null;
  isActive: boolean;
  updatedAt: string; // ISO(낙관락 키)
  children: NavRowDto[];
}
export interface PermissionOption {
  id: string;
  resource: string;
  action: string;
}

// 권한 select의 공개 옵션 토큰(D8 — 명시 선택). 빈 값("")=미선택(저장 불가).
export const PUBLIC_OPTION = "__public__";

export interface NavFormState {
  label: string;
  href: string;             // "" = 그룹 헤더(null)
  parentId: string;         // "" = 대메뉴(null)
  permissionSelect: string; // "" 미선택 | PUBLIC_OPTION 공개 | permissionId
}

function requiredPermissionIdOf(s: NavFormState): string | null {
  return s.permissionSelect === PUBLIC_OPTION ? null : s.permissionSelect || null;
}

// ── 순수 헬퍼(테스트 대상) ──
export function toCreatePayload(s: NavFormState) {
  return {
    label: s.label.trim(),
    href: s.href.trim() || null,
    parentId: s.parentId || null,
    requiredPermissionId: requiredPermissionIdOf(s),
  };
}
export function toUpdatePayload(s: NavFormState, updatedAt: string) {
  return {
    label: s.label.trim(),
    href: s.href.trim() || null,
    requiredPermissionId: requiredPermissionIdOf(s),
    updatedAt,
  };
}
export function hrefWarning(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (!isKnownInternalRoute(h)) return "알려진 내부 경로가 아닙니다 — 페이지가 아직 없을 수 있어요(저장은 가능).";
  return null;
}
export function deleteConfirmLabel(node: { label: string; children: unknown[] }): string {
  const n = node.children.length;
  return n > 0
    ? `'${node.label}'와(과) 하위 메뉴 ${n}개를 함께 삭제합니다. 계속할까요?`
    : `'${node.label}'을(를) 삭제합니다. 계속할까요?`;
}

function permLabel(p: PermissionOption): string {
  return `${p.resource}:${p.action}`;
}
async function jsonOrThrow(res: Response, fallback: string): Promise<void> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${fallback} (${res.status})`);
}

// ── 컴포넌트 ──
export function NavigationEditor({
  tree, permissions, canConfigure,
}: {
  tree: NavRowDto[];
  permissions: PermissionOption[];
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<NavFormState | null>(null); // 추가/수정 폼(null=닫힘)
  const [editingId, setEditingId] = useState<string | null>(null); // null=신규
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const parents = tree; // 최상위만 부모 후보(2단)
  const set = <K extends keyof NavFormState>(k: K, v: NavFormState[K]) => setForm((s) => (s ? { ...s, [k]: v } : s));

  const openNew = () => {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setForm({ label: "", href: "", parentId: "", permissionSelect: "" });
  };
  const openEdit = (n: NavRowDto) => {
    setEditingId(n.id);
    setEditingUpdatedAt(n.updatedAt);
    setForm({
      label: n.label,
      href: n.href ?? "",
      parentId: n.parentId ?? "",
      permissionSelect: n.requiredPermissionId ?? PUBLIC_OPTION,
    });
  };
  const close = () => setForm(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (editingId) {
        const res = await fetch(`/api/admin/navigation/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toUpdatePayload(form, editingUpdatedAt!)),
        });
        await jsonOrThrow(res, "수정 실패");
      } else {
        const res = await fetch("/api/admin/navigation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toCreatePayload(form)),
        });
        await jsonOrThrow(res, "추가 실패");
      }
    },
    onSuccess: () => { close(); router.refresh(); },
  });

  const remove = useMutation({
    mutationFn: async (n: NavRowDto) => {
      const res = await fetch(`/api/admin/navigation/${n.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt: n.updatedAt }),
      });
      await jsonOrThrow(res, "삭제 실패");
    },
    onSuccess: () => router.refresh(),
  });

  const reorder = useMutation({
    mutationFn: async (input: { parentId: string | null; orderedIds: string[] }) => {
      const res = await fetch("/api/admin/navigation/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await jsonOrThrow(res, "순서 변경 실패");
    },
    onSuccess: () => router.refresh(),
  });

  // 형제 묶음 내 i↔i+dir 교환 후 reorder.
  const move = (siblings: NavRowDto[], parentId: string | null, index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= siblings.length) return;
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate({ parentId, orderedIds: ids });
  };

  const canSave = !!form && form.label.trim().length > 0 && form.permissionSelect !== "" && !save.isPending;
  const warn = form ? hrefWarning(form.href) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">메뉴 트리</h2>
          {canConfigure && <Button size="sm" onClick={openNew} disabled={!!form}>+ 메뉴 추가</Button>}
        </div>

        {form && (
          <Card>
            <CardContent className="grid gap-3">
              <strong className="text-sm">{editingId ? "메뉴 수정" : "메뉴 추가"}</strong>
              <div className="grid gap-1.5">
                <Label htmlFor="nav-label">라벨</Label>
                <Input id="nav-label" value={form.label} onChange={(e) => set("label", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nav-href">경로(href) — 비우면 그룹 헤더</Label>
                <Input id="nav-href" value={form.href} placeholder="/example" onChange={(e) => set("href", e.target.value)} />
                {warn && <p className="text-xs text-amber-600">{warn}</p>}
              </div>
              {!editingId && (
                <div className="grid gap-1.5">
                  <Label>부모 메뉴</Label>
                  <select className={selectCls} value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
                    <option value="">— 대메뉴(최상위) —</option>
                    {parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>필요 권한</Label>
                <select className={selectCls} value={form.permissionSelect} onChange={(e) => set("permissionSelect", e.target.value)}>
                  <option value="">— 권한 선택 —</option>
                  <option value={PUBLIC_OPTION}>공개 — 로그인한 모든 사용자</option>
                  {permissions.map((p) => <option key={p.id} value={p.id}>{permLabel(p)}</option>)}
                </select>
                <RolePreview permissionId={requiredPermissionIdOf(form)} selected={form.permissionSelect} />
              </div>
              {save.isError && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={close}>취소</Button>
                <Button size="sm" disabled={!canSave} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "저장"}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <ul className="grid gap-1.5">
          {parents.map((p, pi) => (
            <li key={p.id} className="grid gap-1">
              <NavManageRow
                node={p} index={pi} siblings={parents} parentId={null}
                canConfigure={canConfigure} permissions={permissions}
                onEdit={openEdit} onDelete={(n) => remove.mutate(n)} onMove={move}
              />
              {p.children.length > 0 && (
                <ul className="ml-5 grid gap-1 border-l border-border pl-2">
                  {p.children.map((c, ci) => (
                    <li key={c.id}>
                      <NavManageRow
                        node={c} index={ci} siblings={p.children} parentId={p.id}
                        canConfigure={canConfigure} permissions={permissions}
                        onEdit={openEdit} onDelete={(n) => remove.mutate(n)} onMove={move}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          새 보호영역(새 권한)이 필요한 메뉴는 개발자에게 요청하세요 — 권한 카탈로그는 코드에서 관리됩니다.
        </p>
      </section>

      <aside className="space-y-2">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">사이드바 미리보기</h2>
        <Card>
          <CardContent className="grid gap-1 py-3 text-sm">
            {parents.filter((p) => p.isActive).map((p) => (
              <div key={p.id} className="grid gap-1">
                <span className={p.href ? "" : "text-muted-foreground"}>{p.label}{p.href ? "" : " (그룹)"}</span>
                {p.children.filter((c) => c.isActive).length > 0 && (
                  <div className="ml-3 grid gap-0.5 text-muted-foreground">
                    {p.children.filter((c) => c.isActive).map((c) => <span key={c.id}>· {c.label}</span>)}
                  </div>
                )}
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">* 권한별 실제 노출은 사용자 권한에 따라 달라집니다(추정).</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function NavManageRow({
  node, index, siblings, parentId, canConfigure, permissions, onEdit, onDelete, onMove,
}: {
  node: NavRowDto;
  index: number;
  siblings: NavRowDto[];
  parentId: string | null;
  canConfigure: boolean;
  permissions: PermissionOption[];
  onEdit: (n: NavRowDto) => void;
  onDelete: (n: NavRowDto) => void;
  onMove: (siblings: NavRowDto[], parentId: string | null, index: number, dir: -1 | 1) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const permName = node.requiredPermissionId
    ? permissions.find((p) => p.id === node.requiredPermissionId)
    : null;
  const permChip = node.requiredPermissionId ? (permName ? permLabel(permName) : "권한") : "공개";

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="flex-1 truncate">
          {node.label}
          <span className="ml-2 text-xs text-muted-foreground">{node.href ?? "그룹"}</span>
          {!node.isActive && <span className="ml-2 text-xs text-amber-600">비활성</span>}
        </span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{permChip}</span>
        {canConfigure && (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="위로" disabled={index === 0} onClick={() => onMove(siblings, parentId, index, -1)}>↑</Button>
            <Button size="sm" variant="ghost" aria-label="아래로" disabled={index === siblings.length - 1} onClick={() => onMove(siblings, parentId, index, 1)}>↓</Button>
            <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>수정</Button>
            {!confirming && <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>삭제</Button>}
          </span>
        )}
      </div>
      {canConfigure && confirming && (
        // P4: 자식 수를 title(툴팁)이 아니라 가시 텍스트로 노출 — 터치·키보드·더블클릭에서도
        // "하위 메뉴 N개" 경고를 반드시 보고 확정하게 한다(데이터 손실 방지). 최종 삭제는 이 확인 영역에서.
        <div role="alertdialog" aria-label="메뉴 삭제 확인" className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{deleteConfirmLabel(node)}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>취소</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(node)}>삭제</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 역할 미리보기(D10) — 권한 선택 시 ALLOW 역할 표시(역할 기준 추정).
function RolePreview({ permissionId, selected }: { permissionId: string | null; selected: string }) {
  const [roles, setRoles] = useState<Array<{ key: string; name: string }> | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // 공개·미선택은 미리보기 없음.
  if (selected === "" || selected === PUBLIC_OPTION) {
    if (loadedFor !== null) { setRoles(null); setLoadedFor(null); }
    return <p className="text-xs text-muted-foreground">{selected === PUBLIC_OPTION ? "로그인한 모든 사용자에게 보입니다." : ""}</p>;
  }
  if (permissionId && loadedFor !== permissionId) {
    setLoadedFor(permissionId);
    fetch(`/api/admin/navigation/roles?permissionId=${encodeURIComponent(permissionId)}`)
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => setRoles([]));
  }
  return (
    <p className="text-xs text-muted-foreground">
      이 권한이 보이는 역할: {roles && roles.length > 0 ? roles.map((r) => r.name).join("·") : roles ? "없음" : "…"} (추정)
    </p>
  );
}
```

> 참고: `RolePreview`의 fetch-in-render는 `loadedFor` 가드로 1회만 발사된다(렌더 중 setState는 React가 즉시 재조정). 더 엄격히 하려면 `useEffect`로 옮길 수 있으나, 가드로 충분(추가 의존성 없음). JSX/fetch는 단위테스트 대상 아님.

## Step 3 — page.tsx

`src/app/(app)/admin/navigation/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { listNavigationTree, listPermissionOptions } from "@/modules/admin/navigation/services";
import type { NavigationNodeAdmin } from "@/modules/admin/navigation/repositories";
import { NavigationEditor, type NavRowDto } from "./_components/navigation-editor";

function serializeNode(n: NavigationNodeAdmin): NavRowDto {
  return {
    id: n.id, key: n.key, label: n.label, href: n.href, parentId: n.parentId,
    sortOrder: n.sortOrder, requiredPermissionId: n.requiredPermissionId, isActive: n.isActive,
    updatedAt: n.updatedAt.toISOString(),
    children: n.children.map(serializeNode),
  };
}

export default async function AdminNavigationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const summary = await getPermissionSummary(session.user.id);
  const canView = summary.isOwner || summary.keys.includes("admin.navigation:view");
  if (!canView) redirect("/dashboard");
  const canConfigure = summary.isOwner || summary.keys.includes("admin.navigation:configure");

  const [tree, permissions] = await Promise.all([listNavigationTree(), listPermissionOptions()]);
  return (
    <NavigationEditor
      tree={tree.map(serializeNode)}
      permissions={permissions}
      canConfigure={canConfigure}
    />
  );
}
```

## Step 4 — admin-tabs.tsx에 탭 추가

`src/app/(app)/admin/_components/admin-tabs.tsx`:

`TABS` 배열에 추가:

```ts
  { href: "/admin/navigation", label: "메뉴 관리", resource: "admin.navigation", action: "view" },
```

`TAB_TONES`에 추가:

```ts
  "/admin/navigation": {
    dot: "bg-nav-admin",
    active: "border-nav-admin/40 bg-nav-admin/15 text-fuchsia-800 dark:text-fuchsia-100",
    hover: "hover:border-nav-admin/30 hover:bg-nav-admin/10",
  },
```

(`Tab`의 `useCan(tab.resource, tab.action)`가 권한 없으면 자동 숨김 — 기존 패턴.)

실행: `npm test -- admin/navigation/payload` → **PASS**.

## Acceptance Criteria

- `npm test -- admin/navigation/payload` → 전부 PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors.
- `npm run build` → 성공.
- (수동·dev) `/admin/navigation` 진입: 트리 표시, 추가/수정/삭제·↑/↓ 순서변경·필요권한 select(공개 명시)·역할 미리보기·미리보기 패널·한계 안내 동작. 권한 없는 사용자는 `/dashboard`로 redirect, 사이드바에 `관리 > 메뉴 관리` 노출(권한자만).
- (수동·dev) **삭제 확인(P4):** "삭제" 클릭 시 자식 있는 부모는 "하위 메뉴 N개를 함께 삭제합니다" 문구가 **화면에 보이는 확인 영역**으로 표시되고, 그 안의 "삭제"를 눌러야 실제 삭제됨(툴팁 아님). 첫 클릭만으로는 삭제되지 않음.
