"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit() {
    if (next.length < 12) { setErrorMsg("새 비밀번호는 12자 이상이어야 합니다."); return; }
    if (next !== confirm) { setErrorMsg("새 비밀번호가 일치하지 않습니다."); return; }
    setErrorMsg("");
    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("done");
        // 강제변경 완료 후 대시보드로, 자발 변경은 그 자리에서 완료 표시
        if (mustChange) {
          router.push("/dashboard");
        }
      } else {
        setErrorMsg((data as { error?: string }).error ?? "비밀번호 변경에 실패했습니다.");
        if (res.status === 409) {
          // CAS 충돌 — 재로그인 필요
          setErrorMsg("세션이 만료되었습니다. 다시 로그인해 주세요.");
        }
        setStatus("error");
      }
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
      setStatus("error");
    }
  }

  if (status === "done" && !mustChange) {
    return <p className="text-sm text-center font-medium">비밀번호가 변경되었습니다.</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cp-cur">현재 비밀번호</Label>
        <Input
          id="cp-cur" type="password" value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cp-new">새 비밀번호 (12자 이상)</Label>
        <Input
          id="cp-new" type="password" value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          aria-invalid={next.length > 0 && next.length < 12}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cp-confirm">새 비밀번호 확인</Label>
        <Input
          id="cp-confirm" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={confirm.length > 0 && confirm !== next}
        />
      </div>
      {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
      <Button disabled={status === "submitting" || !current} onClick={() => { void handleSubmit(); }}>
        {status === "submitting" ? "변경 중…" : "비밀번호 변경"}
      </Button>
    </div>
  );
}
