"use client";

import { useState } from "react";

export function SettingEditor({
  settingKey,
  initialValue,
  updatedAt,
}: {
  settingKey: string;
  initialValue: unknown;
  updatedAt: string | null; // ISO 또는 null(아직 override 없음)
}) {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));
  const [token, setToken] = useState<string | null>(updatedAt);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    // 클라이언트는 최소 UX 검증(JSON 파싱)만. 진짜 검증은 서버 Zod.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setMessage("형식 오류: 올바른 JSON이 아닙니다.");
      return;
    }
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsed, expectedUpdatedAt: token }),
    });
    setSaving(false);
    if (res.status === 409) {
      setMessage("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
      return;
    }
    if (res.status === 422) {
      setMessage("검증 실패: 값 형식을 확인하세요.");
      return;
    }
    if (!res.ok) {
      setMessage("저장 실패.");
      return;
    }
    const body = (await res.json()) as { updatedAt: string };
    setToken(body.updatedAt);
    setMessage("저장됨.");
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ fontFamily: "monospace", width: "100%" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
        {message ? <span style={{ color: "var(--muted)" }}>{message}</span> : null}
      </div>
    </div>
  );
}
