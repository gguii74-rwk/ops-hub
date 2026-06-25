"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type EditorProps = {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
};

export function SettingEditor(props: EditorProps) {
  // boolean 설정은 토글 UI, 그 외는 기존 raw JSON textarea(회귀 없음).
  if (typeof props.initialValue === "boolean") {
    return (
      <BooleanSettingEditor
        settingKey={props.settingKey}
        initialValue={props.initialValue}
        updatedAt={props.updatedAt}
      />
    );
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
    // 요청 전송/응답 수신 실패 — 반영 여부 불명.
    toast.error("저장 결과를 확인할 수 없습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 409) {
    // 행이 이미 변경됨 → prev도 stale. 롤백 금지, 권위 재조회.
    toast.error("다른 사용자가 먼저 변경했습니다. 최신 상태를 확인하세요.");
    return { kind: "refetch" };
  }
  if (res.status === 422) {
    toast.error("검증 실패: 값 형식을 확인하세요.");
    return { kind: "rejected" }; // 값 거부, 행 불변 → prev 권위 유지
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
    // 2xx인데 본문 파싱 실패 — 반영됐을 가능성.
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

  // 서버 권위 상태 재동기화: router.refresh() 후 server component가 새 initialValue/updatedAt을 내려보내면 반영.
  // (useState 초기화는 1회뿐이므로, refresh로 갱신된 props를 토글 상태에 흘려보내려면 이 sync가 필요.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 토글 상태를 props 변경과 동기화하기 위한 의도된 패턴
    setChecked(initialValue);
    setToken(updatedAt);
  }, [initialValue, updatedAt]);

  async function toggle(next: boolean) {
    const prev = checked;
    setChecked(next); // 낙관적 업데이트
    setSaving(true);
    let result: PutResult;
    try {
      result = await putSetting(settingKey, next, token);
    } finally {
      setSaving(false); // 성공·실패·예외 무관 항상 재활성화
    }
    if (result.kind === "ok") {
      setToken(result.token);
      return;
    }
    if (result.kind === "rejected") {
      setChecked(prev); // 값 거부·행 불변 → prev가 권위값 → 롤백
      return;
    }
    // refetch: prev/next 모두 stale일 수 있음(409 충돌 또는 결과 불명) → 단정 금지, 권위 상태 재조회.
    // (toast는 putSetting이 이미 띄움. useEffect가 새 props를 토글 상태에 반영.)
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={toggle} disabled={saving} label={settingKey} />
      <span className="text-sm text-muted-foreground">{checked ? "켜짐" : "꺼짐"}</span>
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
    // 클라이언트는 최소 UX 검증(JSON 파싱)만. 진짜 검증은 서버 Zod.
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
    // rejected/refetch: putSetting이 이미 사유 토스트를 띄움. JSON 경로는 사용자가 입력한 textarea 내용을
    // 보존해야 하므로 router.refresh(=props 재초기화)하지 않는다(토큰 미갱신 → 다음 저장 시 409로 재확인 유도).
  }

  return (
    <div className="grid gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="font-mono"
      />
      <div>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}
