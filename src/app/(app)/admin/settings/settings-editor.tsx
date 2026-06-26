"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type EditorProps = {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
};

export function SettingEditor(props: EditorProps) {
  const v = props.initialValue;
  // 값 타입으로 편집기 선택(D8). 서버 zod가 여전히 권위 검증.
  // Array.isArray는 typeof object보다 먼저(배열도 object이므로) — JSON 폴백은 객체 전용.
  if (typeof v === "boolean") {
    return <BooleanSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  if (typeof v === "number") {
    return <NumberSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  if (Array.isArray(v)) {
    return <ListSettingEditor settingKey={props.settingKey} initialValue={v as string[]} updatedAt={props.updatedAt} />;
  }
  if (typeof v === "string") {
    return <StringSettingEditor settingKey={props.settingKey} initialValue={v} updatedAt={props.updatedAt} />;
  }
  return <JsonSettingEditor {...props} />;
}

// PUT 공통 결과(판별 유니온): **절대 throw하지 않는다.**
//  - ok       : 서버가 새 토큰을 확정 반환 → 성공.
//  - rejected : 서버가 값 자체를 거부했고 행은 그대로(422/그 외 !ok). 로컬 prev가 여전히 권위값 → 안전 롤백.
//  - refetch  : 로컬 상태가 권위가 아님 → 권위 상태를 재조회해야 한다. 두 경우:
//      (1) 409 충돌 — 다른 사용자가 행을 바꿈 → 낙관값 next도, 롤백 대상 prev도 stale(둘 다 거짓).
//      (2) 응답 미수신(fetch 거부)·2xx 본문 파싱 실패 — 반영 여부 불명.
//   putSetting이 모든 사용자 토스트를 전담한다(콜러는 상태 전이만).
type PutResult = { kind: "ok"; token: string } | { kind: "rejected" } | { kind: "refetch" };

async function putSetting(
  settingKey: string,
  value: unknown,
  token: string | null,
): Promise<PutResult> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, expectedUpdatedAt: token }),
    });
  } catch {
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 409) {
    toast.error("다른 사용자가 먼저 변경했습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 422) {
    toast.error("검증 실패: 값 형식을 확인하세요.");
    return { kind: "rejected" };
  }
  if (!res.ok) {
    toast.error("저장에 실패했습니다.");
    return { kind: "rejected" };
  }
  try {
    const body = (await res.json()) as { updatedAt?: unknown };
    if (typeof body.updatedAt !== "string") {
      toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
      return { kind: "refetch" };
    }
    toast.success("저장되었습니다.");
    return { kind: "ok", token: body.updatedAt };
  } catch {
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
}

function BooleanSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: boolean;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(initialValue);
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 토글 상태를 props 변경과 동기화하기 위한 의도된 패턴
    setChecked(initialValue);
    setToken(updatedAt);
  }, [initialValue, updatedAt]);

  async function toggle(next: boolean) {
    const prev = checked;
    setChecked(next);
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, next, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") {
      setToken(result.token);
      return;
    }
    if (result.kind === "rejected") {
      setChecked(prev);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={toggle} disabled={saving} label={settingKey} />
      <span className="text-sm text-muted-foreground">{checked ? "켜짐" : "꺼짐"}</span>
    </div>
  );
}

function StringSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: string;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(initialValue);
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, text, token);
    } finally {
      setSaving(false);
    }
    // ok면 토큰 갱신. rejected/refetch는 putSetting이 토스트를 띄우고, 입력 보존 위해 refresh 안 함.
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="flex items-center gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} className="max-w-md" />
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}

function NumberSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: number;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(String(initialValue));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      toast.error("형식 오류: 숫자를 입력하세요.");
      return;
    }
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, n, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="flex items-center gap-2">
      <Input type="number" value={text} onChange={(e) => setText(e.target.value)} className="max-w-[12rem]" />
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ListSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: string[];
  updatedAt: string | null;
}) {
  // 이메일 리스트만 클라 형식 검증(나머지는 비어있지 않음+중복만). 서버 zod가 권위.
  const requireEmail = settingKey === "workflows.weeklyReport.defaultRecipients";
  const [items, setItems] = useState<string[]>(initialValue);
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  function addItem() {
    const v = draft.trim();
    if (!v) return;
    if (requireEmail && !EMAIL_RE.test(v)) {
      toast.error("이메일 형식이 아닙니다.");
      return;
    }
    if (items.includes(v)) {
      toast.error("이미 추가된 항목입니다.");
      return;
    }
    setItems([...items, v]);
    setDraft("");
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, items, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="grid gap-2">
      {items.length > 0 ? (
        <ul className="grid gap-1">
          {items.map((it, idx) => (
            <li key={`${it}-${idx}`} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{it}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={`${it} 삭제`} onClick={() => removeItem(idx)}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">항목 없음</div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder="추가할 항목 입력"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          className="max-w-md"
        />
        <Button type="button" size="sm" variant="secondary" onClick={addItem}>
          추가
        </Button>
      </div>
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}

function JsonSettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("형식 오류: 올바른 JSON이 아닙니다.");
      return;
    }
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, parsed, token);
    } finally {
      setSaving(false);
    }
    if (result.kind === "ok") setToken(result.token);
  }

  return (
    <div className="grid gap-1.5">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="font-mono" />
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}
