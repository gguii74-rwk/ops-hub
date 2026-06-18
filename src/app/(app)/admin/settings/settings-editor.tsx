"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

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
    const res = await fetch(`/api/admin/settings/${encodeURIComponent(settingKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsed, expectedUpdatedAt: token }),
    });
    setSaving(false);
    if (res.status === 409) {
      toast.error("다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.");
      return;
    }
    if (res.status === 422) {
      toast.error("검증 실패: 값 형식을 확인하세요.");
      return;
    }
    if (!res.ok) {
      toast.error("저장에 실패했습니다.");
      return;
    }
    const body = (await res.json()) as { updatedAt: string };
    setToken(body.updatedAt);
    toast.success("저장되었습니다.");
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
