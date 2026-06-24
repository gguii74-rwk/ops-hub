"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
// RolePreview useEffect가 각 fetch 발사 시 단조증가 토큰을 캡처한다.
// 응답 도착 시 isLatestRequest(캡처 토큰, 현재 토큰 ref)로 "나 아직 최신?"을 판단.
// stale 응답(느린 A가 빠른 B 이후 도착)은 false → setRoles 건너뜀 — 표시 역할이 B로 유지.
export function isLatestRequest(token: number, currentToken: number): boolean {
  return token === currentToken;
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

  // 형제 묶음 내 i↔i+dir 교환 후 reorder. 각 형제의 관측 updatedAt 동반(P6 — 동시 재정렬 lost-update 차단).
  const move = (siblings: NavRowDto[], parentId: string | null, index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= siblings.length) return;
    const ordered = [...siblings];
    [ordered[index], ordered[j]] = [ordered[j], ordered[index]];
    reorder.mutate({ parentId, orderedItems: ordered.map((s) => ({ id: s.id, updatedAt: s.updatedAt })) });
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
// P10 fix: fetch를 useEffect로 이전. 키(permissionId/selected) 변경 시 roles 리셋(새 선택이 이전 결과 표시 방지).
// out-of-order 응답 가드(이중 방어):
//   ① AbortController — 키 변경 시 이전 fetch 취소(주 방어선, 대부분의 race 원천 차단).
//   ② 단조증가 요청 토큰(useRef) — abort가 완료되기 전 극단적 타이밍에 도달하는 stale 응답 2차 방어.
//      isLatestRequest(캡처 토큰, 현재 ref 토큰) 순수 헬퍼로 판단 → 단위테스트 가능(payload.test.ts P10 섹션).
// loaded: { permissionId, roles } 쌍으로 추적 — 현재 permissionId와 다르면 "…" 표시(키 변경 즉시 이전 결과 숨김).
// 효과: setRoles를 effect 본문에서 동기 호출하지 않아도 됨(lint react-hooks/set-state-in-effect 회피 + 정확한 stale 숨김).
type RoleResult = { permissionId: string; roles: Array<{ key: string; name: string }> };

function RolePreview({ permissionId, selected }: { permissionId: string | null; selected: string }) {
  const [loaded, setLoaded] = useState<RoleResult | null>(null);
  // useRef: 렌더를 유발하지 않으면서 최신 토큰을 추적. effect 안에서 동기 갱신 — lint 경고 없음.
  const tokenRef = useRef(0);

  useEffect(() => {
    // 공개·미선택은 프리뷰 없음 — setLoaded 호출 없이 return. 렌더 분기(아래)가 숨김 처리.
    if (selected === "" || selected === PUBLIC_OPTION || !permissionId) {
      return;
    }
    // 이 effect 실행에 대한 단조증가 토큰 발급(ref → 동기 갱신, 렌더 비유발).
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    // ① AbortController: 키 변경 시 이전 fetch 취소(out-of-order 주 방어선).
    const controller = new AbortController();

    fetch(`/api/admin/navigation/roles?permissionId=${encodeURIComponent(permissionId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d: { roles?: Array<{ key: string; name: string }> }) => {
        // ② 토큰 비교: abort 완료 전 극단적 타이밍에 도달한 stale 응답 2차 방어.
        if (!isLatestRequest(token, tokenRef.current)) return;
        setLoaded({ permissionId, roles: d.roles ?? [] });
      })
      .catch(() => {
        // AbortError(effect cleanup에서 controller.abort()): 조용히 무시.
        // 그 외 네트워크 에러: "…" 상태 유지(다음 선택 변경까지).
      });

    return () => {
      controller.abort();
    };
  }, [permissionId, selected]);

  if (selected === "" || selected === PUBLIC_OPTION) {
    return <p className="text-xs text-muted-foreground">{selected === PUBLIC_OPTION ? "로그인한 모든 사용자에게 보입니다." : ""}</p>;
  }
  // loaded가 없거나 다른 permissionId의 결과면 "…"(키 변경 즉시 이전 결과 숨김).
  const roles = loaded?.permissionId === permissionId ? loaded.roles : null;
  return (
    <p className="text-xs text-muted-foreground">
      이 권한이 보이는 역할: {roles && roles.length > 0 ? roles.map((r) => r.name).join("·") : roles ? "없음" : "…"} (추정)
    </p>
  );
}
