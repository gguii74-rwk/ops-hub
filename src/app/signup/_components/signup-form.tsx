"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type EmploymentType = "REGULAR" | "CONTRACTOR";
type JobFunction = "PM" | "DEVELOPER" | "CONTENT_MANAGER" | "CIVIL_RESPONSE";

const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: "REGULAR", label: "정규직" },
  { value: "CONTRACTOR", label: "외주" },
];
const JOB_OPTIONS: Array<{ value: JobFunction; label: string }> = [
  { value: "PM", label: "PM" },
  { value: "DEVELOPER", label: "개발" },
  { value: "CONTENT_MANAGER", label: "콘텐츠" },
  { value: "CIVIL_RESPONSE", label: "민원대응" },
];

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("REGULAR");
  const [jobFunction, setJobFunction] = useState<JobFunction>("DEVELOPER");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (status === "done") {
    return (
      <div className="space-y-2 text-center text-sm">
        <p className="font-medium">신청이 접수되었습니다.</p>
        <p className="text-muted-foreground">이메일을 확인해 비밀번호를 설정하고 관리자 승인을 기다려 주세요.</p>
      </div>
    );
  }

  async function handleSubmit() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, employmentType, jobFunction }),
      });
      if (res.status === 202 || res.ok) {
        setStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { error?: string }).error ?? "요청에 실패했습니다. 다시 시도해 주세요.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="s-email">이메일</Label>
        <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s-name">이름</Label>
        <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>고용형태</Label>
          <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
            {EMPLOYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>직무</Label>
          <Select value={jobFunction} onChange={(e) => setJobFunction(e.target.value as JobFunction)}>
            {JOB_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      </div>
      {status === "error" ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
      <Button disabled={status === "loading" || !email || !name} onClick={() => { void handleSubmit(); }}>
        {status === "loading" ? "신청 중…" : "가입 신청"}
      </Button>
    </div>
  );
}
