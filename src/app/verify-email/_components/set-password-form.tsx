"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type PageState = "checking" | "invalid" | "ready" | "submitting" | "done" | "error";

export function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [pageState, setPageState] = useState<PageState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!token) { if (!cancelled) setPageState("invalid"); return; }
      try {
        const r = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        if (!cancelled) setPageState(r.ok ? "ready" : "invalid");
      } catch {
        if (!cancelled) setPageState("invalid");
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit() {
    if (password.length < 12) { setErrorMsg("비밀번호는 12자 이상이어야 합니다."); return; }
    if (password !== confirm) { setErrorMsg("비밀번호가 일치하지 않습니다."); return; }
    setErrorMsg("");
    setPageState("submitting");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setPageState("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { error?: string }).error ?? "오류가 발생했습니다.");
        setPageState("error");
      }
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
      setPageState("error");
    }
  }

  if (pageState === "checking") return <p className="text-sm text-muted-foreground">링크를 확인하는 중…</p>;

  if (pageState === "invalid") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">유효하지 않거나 만료된 링크입니다.</p>
        <p className="text-muted-foreground">가입 신청 화면에서 검증 메일을 다시 요청하세요.</p>
        <Link href="/signup" className="underline underline-offset-4 hover:text-foreground">가입 신청으로 돌아가기</Link>
      </div>
    );
  }

  if (pageState === "done") {
    return (
      <div className="space-y-2 text-center text-sm">
        <p className="font-medium">비밀번호가 설정되었습니다.</p>
        <p className="text-muted-foreground">관리자 승인 후 로그인하실 수 있습니다.</p>
        <Link href="/login" className="underline underline-offset-4 hover:text-foreground">로그인으로 이동</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">이메일이 확인되었습니다. 사용할 비밀번호를 설정하세요.</p>
      <div className="grid gap-1.5">
        <Label htmlFor="vp-pw">비밀번호 (12자 이상)</Label>
        <Input
          id="vp-pw" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          aria-invalid={password.length > 0 && password.length < 12}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="vp-confirm">비밀번호 확인</Label>
        <Input
          id="vp-confirm" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={confirm.length > 0 && confirm !== password}
        />
      </div>
      {(pageState === "error" || errorMsg) ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
      <Button disabled={pageState === "submitting"} onClick={() => { void handleSubmit(); }}>
        {pageState === "submitting" ? "설정 중…" : "비밀번호 설정"}
      </Button>
    </div>
  );
}
