"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Chip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-section";
import { isKnownInternalRoute } from "@/modules/admin/navigation/href";

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
// 이동(reparent — P8): 수정 시 부모 변경은 /reparent 전용 경로로(PATCH는 parentId 생략). 빈 부모="" → null(대메뉴 승격).
export function toReparentPayload(s: NavFormState, updatedAt: string) {
  return { newParentId: s.parentId || null, updatedAt };
}
// 삭제(P9 — cascade TOCTOU): 확인 화면에 보인 직속 자식 ID 집합을 함께 보낸다. 서버가 현재 DB 자식 집합과
// 대조해 불일치(렌더 후 추가/이동된 자식) 시 409 — 확인 안 된 자식의 cascade 오삭제 차단. updatedAt은 낙관락 키.
export function toDeletePayload(node: { updatedAt: string; children: Array<{ id: string }> }) {
  return { updatedAt: node.updatedAt, confirmedChildIds: node.children.map((c) => c.id) };
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

// ── P10 순수 헬퍼 — out-of-order 응답 가드 ──
export function isLatestRequest(token: number, currentToken: number): boolean {
  return token === currentToken;
}

// ── Handle Cards 순수 헬퍼(테스트 대상) ──
// from→to로 원소를 옮긴 새 배열(원본 불변). 드래그/키보드 재정렬 공통.
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}
// 활성 토글 PATCH 바디 — isActive 반전 + updatedAt(낙관락) 동반.
export function toToggleActivePayload(node: { isActive: boolean; updatedAt: string }) {
  return { isActive: !node.isActive, updatedAt: node.updatedAt };
}

// 대메뉴 도메인 색 점(알려진 key만, 그 외 중립).
const NAV_DOT: Record<string, string> = {
  dashboard: "bg-nav-dashboard",
  calendar: "bg-nav-calendar",
  workflows: "bg-nav-workflows",
  leave: "bg-nav-leave",
  admin: "bg-nav-admin",
};
function navDotClass(key: string): string {
  return NAV_DOT[key] ?? "bg-slate-300 dark:bg-slate-600";
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
  const [editingOriginalParentId, setEditingOriginalParentId] = useState<string | null>(null); // 수정 진입 시 원래 부모(이동 변경 감지 — P8)
  const parents = tree; // 최상위만 부모 후보(2단)
  const set = <K extends keyof NavFormState>(k: K, v: NavFormState[K]) => setForm((s) => (s ? { ...s, [k]: v } : s));

  const openNew = () => {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setEditingOriginalParentId(null);
    setForm({ label: "", href: "", parentId: "", permissionSelect: "" });
  };
  const openEdit = (n: NavRowDto) => {
    setEditingId(n.id);
    setEditingUpdatedAt(n.updatedAt);
    setEditingOriginalParentId(n.parentId);
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
        body: JSON.stringify(toDeletePayload(n)), // P9: 확인한 자식 집합 동반(cascade TOCTOU 차단)
      });
      await jsonOrThrow(res, "삭제 실패");
    },
    onSuccess: () => router.refresh(),
  });

  const reorder = useMutation({
    mutationFn: async (input: { parentId: string | null; orderedItems: Array<{ id: string; updatedAt: string }> }) => {
      const res = await fetch("/api/admin/navigation/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await jsonOrThrow(res, "순서 변경 실패");
    },
    onSuccess: () => router.refresh(),
  });

  // 이동(reparent — P8): 수정 시 부모 변경을 /reparent로 적용(낙관락 updatedAt 동반, 409 시 메시지). 성공 시 폼 닫고 갱신.
  const reparent = useMutation({
    mutationFn: async () => {
      if (!form || !editingId) return;
      const res = await fetch(`/api/admin/navigation/${editingId}/reparent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toReparentPayload(form, editingUpdatedAt!)),
      });
      await jsonOrThrow(res, "이동 실패");
    },
    onSuccess: () => { close(); router.refresh(); },
  });

  // 활성 토글(P-active): isActive 반전 PATCH(낙관락 동반). 같은 PATCH 경로(updateNavSchema.isActive).
  const toggleActive = useMutation({
    mutationFn: async (n: NavRowDto) => {
      const res = await fetch(`/api/admin/navigation/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toToggleActivePayload(n)),
      });
      await jsonOrThrow(res, "활성 변경 실패");
    },
    onSuccess: () => router.refresh(),
  });

  // 형제 묶음 새 순서 → reorder. 각 형제의 관측 updatedAt 동반(P6 — 동시 재정렬 lost-update 차단).
  const reorderSiblings = (parentId: string | null, ordered: NavRowDto[]) => {
    reorder.mutate({ parentId, orderedItems: ordered.map((s) => ({ id: s.id, updatedAt: s.updatedAt })) });
  };

  const canSave = !!form && form.label.trim().length > 0 && form.permissionSelect !== "" && !save.isPending;
  const warn = form ? hrefWarning(form.href) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="내비게이션"
        title="메뉴 트리"
        actions={canConfigure ? <Button size="sm" onClick={openNew} disabled={!!form}>＋ 메뉴 추가</Button> : null}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="space-y-4">
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
                <div className="grid gap-1.5">
                  <Label>부모 메뉴</Label>
                  <div className="flex gap-2">
                    <Select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
                      <option value="">— 대메뉴(최상위) —</option>
                      {parents.filter((p) => p.id !== editingId).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                    {editingId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={(form.parentId || null) === editingOriginalParentId || reparent.isPending}
                        onClick={() => reparent.mutate()}
                      >
                        {reparent.isPending ? "이동 중…" : "이동"}
                      </Button>
                    )}
                  </div>
                  {editingId && (
                    <p className="text-xs text-muted-foreground">부모 변경은 &quot;이동&quot;으로 즉시 적용됩니다(라벨·경로·권한은 &quot;저장&quot;).</p>
                  )}
                  {reparent.isError && <p className="text-xs text-destructive">{(reparent.error as Error).message}</p>}
                </div>
                <div className="grid gap-1.5">
                  <Label>필요 권한</Label>
                  <Select value={form.permissionSelect} onChange={(e) => set("permissionSelect", e.target.value)}>
                    <option value="">— 권한 선택 —</option>
                    <option value={PUBLIC_OPTION}>공개 — 로그인한 모든 사용자</option>
                    {permissions.map((p) => <option key={p.id} value={p.id}>{permLabel(p)}</option>)}
                  </Select>
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

          <div className="rounded-xl border border-border bg-card p-2">
            <SortableList
              items={parents}
              parentId={null}
              depth={0}
              canConfigure={canConfigure}
              permissions={permissions}
              onReorder={reorderSiblings}
              onEdit={openEdit}
              onDelete={(n) => remove.mutate(n)}
              onToggle={(n) => toggleActive.mutate(n)}
            />
          </div>

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
    </div>
  );
}

// 같은 부모 형제 묶음의 드래그/키보드 정렬 리스트. depth 0=대메뉴, 1=중메뉴.
// 비드래그 시 props(items)를 직접 렌더 → 서버 갱신이 항상 즉시 반영(로컬 state 동기화 불필요).
// 드래그 중에만 drag.order로 라이브 재정렬, 드롭 시 onReorder로 커밋(같은 부모 내에서만).
function SortableList({
  items, parentId, depth, canConfigure, permissions, onReorder, onEdit, onDelete, onToggle,
}: {
  items: NavRowDto[];
  parentId: string | null;
  depth: 0 | 1;
  canConfigure: boolean;
  permissions: PermissionOption[];
  onReorder: (parentId: string | null, ordered: NavRowDto[]) => void;
  onEdit: (n: NavRowDto) => void;
  onDelete: (n: NavRowDto) => void;
  onToggle: (n: NavRowDto) => void;
}) {
  const [drag, setDrag] = useState<{ order: NavRowDto[]; index: number; start: number } | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const view = drag?.order ?? items;

  // 포인터 Y가 어느 형제 카드의 중점 위에 있는지 → 삽입 인덱스.
  const targetIndex = (clientY: number): number => {
    for (let k = 0; k < view.length; k++) {
      const el = rowRefs.current[k];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return k;
    }
    return view.length - 1;
  };

  const onPointerDown = (i: number) => (e: React.PointerEvent) => {
    if (!canConfigure) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ order: items, index: i, start: i });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d) return d;
      const t = targetIndex(e.clientY);
      if (t === d.index || t < 0) return d;
      return { order: moveItem(d.order, d.index, t), index: t, start: d.start };
    });
  };
  const onPointerUp = () => {
    setDrag((d) => {
      if (d && d.index !== d.start) onReorder(parentId, d.order);
      return null;
    });
  };
  const onKeyDown = (i: number) => (e: React.KeyboardEvent) => {
    if (!canConfigure) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    const t = i + dir;
    if (t < 0 || t >= items.length) return;
    e.preventDefault();
    onReorder(parentId, moveItem(items, i, t));
  };

  return (
    <ul className={depth === 0 ? "grid gap-1.5" : "relative ml-5 grid gap-1.5 border-l border-border pl-3"}>
      {view.map((node, i) => (
        <li key={node.id}>
          <NavCardRow
            node={node}
            depth={depth}
            canConfigure={canConfigure}
            permissions={permissions}
            dragging={!!drag && drag.index === i}
            rowRef={(el) => { rowRefs.current[i] = el; }}
            handle={canConfigure ? {
              onPointerDown: onPointerDown(i),
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onKeyDown: onKeyDown(i),
            } : null}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggle={onToggle}
          />
          {depth === 0 && node.children.length > 0 && (
            <div className="mt-1.5">
              <SortableList
                items={node.children}
                parentId={node.id}
                depth={1}
                canConfigure={canConfigure}
                permissions={permissions}
                onReorder={onReorder}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggle={onToggle}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

type HandleProps = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

function NavCardRow({
  node, depth, canConfigure, permissions, dragging, rowRef, handle, onEdit, onDelete, onToggle,
}: {
  node: NavRowDto;
  depth: 0 | 1;
  canConfigure: boolean;
  permissions: PermissionOption[];
  dragging: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  handle: HandleProps | null;
  onEdit: (n: NavRowDto) => void;
  onDelete: (n: NavRowDto) => void;
  onToggle: (n: NavRowDto) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const permName = node.requiredPermissionId ? permissions.find((p) => p.id === node.requiredPermissionId) : null;
  const permChip = node.requiredPermissionId ? (permName ? permLabel(permName) : "권한") : "공개";

  return (
    <div className="grid gap-1.5">
      <div
        ref={rowRef}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
          depth === 0 ? "border-border bg-card" : "border-border bg-muted/30",
          dragging && "relative z-10 shadow-lg",
          !node.isActive && "opacity-60",
        )}
      >
        {handle ? (
          <button
            type="button"
            aria-label={`${node.label} 순서 변경 — 드래그하거나 위/아래 화살표 키`}
            className="grid shrink-0 cursor-grab touch-none grid-cols-2 gap-0.5 rounded p-1.5 text-slate-400 hover:text-muted-foreground active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring"
            onPointerDown={handle.onPointerDown}
            onPointerMove={handle.onPointerMove}
            onPointerUp={handle.onPointerUp}
            onPointerCancel={handle.onPointerCancel}
            onKeyDown={handle.onKeyDown}
          >
            {Array.from({ length: 6 }).map((_, i) => <span key={i} className="size-[3px] rounded-full bg-current" />)}
          </button>
        ) : null}

        {depth === 0 ? <span className={cn("size-2.5 shrink-0 rounded-sm", navDotClass(node.key))} aria-hidden /> : null}

        <span className={cn("truncate", depth === 0 ? "font-semibold" : "font-medium")}>{node.label}</span>
        <span className="truncate text-xs text-slate-400">{node.href ?? "그룹"}</span>

        <span className="ml-auto inline-flex items-center gap-2">
          <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground">{permChip}</span>
          {canConfigure ? (
            <Switch checked={node.isActive} onCheckedChange={() => onToggle(node)} label={`${node.label} 활성`} />
          ) : (
            <Chip tone={node.isActive ? "ok" : "off"}>{node.isActive ? "활성" : "비활성"}</Chip>
          )}
          {canConfigure ? (
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>수정</Button>
              {!confirming && <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>삭제</Button>}
            </span>
          ) : null}
        </span>
      </div>

      {canConfigure && confirming && (
        // P4/P9: 자식 수를 가시 텍스트로 노출(터치·키보드·더블클릭에서도 "하위 메뉴 N개" 경고 확정 — 데이터 손실 방지).
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
// P10: fetch를 useEffect로. 키 변경 시 ① AbortController로 이전 fetch 취소 ② 단조증가 토큰으로 stale 응답 2차 방어.
type RoleResult = { permissionId: string; roles: Array<{ key: string; name: string }> };

function RolePreview({ permissionId, selected }: { permissionId: string | null; selected: string }) {
  const [loaded, setLoaded] = useState<RoleResult | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (selected === "" || selected === PUBLIC_OPTION || !permissionId) {
      return;
    }
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    const controller = new AbortController();

    fetch(`/api/admin/navigation/roles?permissionId=${encodeURIComponent(permissionId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d: { roles?: Array<{ key: string; name: string }> }) => {
        if (!isLatestRequest(token, tokenRef.current)) return;
        setLoaded({ permissionId, roles: d.roles ?? [] });
      })
      .catch(() => {
        // AbortError(cleanup): 무시. 그 외: "…" 유지.
      });

    return () => {
      controller.abort();
    };
  }, [permissionId, selected]);

  if (selected === "" || selected === PUBLIC_OPTION) {
    return <p className="text-xs text-muted-foreground">{selected === PUBLIC_OPTION ? "로그인한 모든 사용자에게 보입니다." : ""}</p>;
  }
  const roles = loaded?.permissionId === permissionId ? loaded.roles : null;
  return (
    <p className="text-xs text-muted-foreground">
      이 권한이 보이는 역할: {roles && roles.length > 0 ? roles.map((r) => r.name).join("·") : roles ? "없음" : "…"} (추정)
    </p>
  );
}
