# Task 08 — UI (가입·강제변경·목록·승인모달·직접추가·편집·override패널·nav)

**Purpose:** spec 섹션 7의 모든 화면을 채운다 — 공개 가입(`signup`, 비번 없음)·비번 설정/검증(`verify-email`)·강제/자가 비번변경(`account/password`)·사용자 목록(서버 게이트 + 클라이언트 필터/페이지네이션/PENDING 배지)·승인/거절 모달·직접추가(`admin/users/new`)·편집(`admin/users/[id]`, 속성·systemRole·상태토글·역할 체크리스트·개인 override 패널·비번 재설정)·`admin-links.tsx`의 `/admin/users` 연결. API는 task-05/06/07이 제공하고 이 task는 fetch로 호출만 한다. **서버 컴포넌트 게이트는 `hasPermission`/`getPermissionSummary`, 클라이언트 표시는 `useCan` — 둘 다 동일 permission 키. UI 숨김은 UX일 뿐, 실행 권한은 API가 동일 키로 검사한다(spec 섹션 6).**

## Files
- Create: `src/app/signup/page.tsx` — 공개 가입(login 미러, server action으로 `/api/auth/signup` 호출)
- Create: `src/app/verify-email/page.tsx` — 토큰 확인 + 비번 설정 폼(클라이언트 컴포넌트 사용)
- Create: `src/app/verify-email/_components/set-password-form.tsx` — POST `/api/auth/verify-email`
- Create: `src/app/(app)/account/password/page.tsx` — 강제/자가 비번변경(서버 게이트: 세션 존재) + 폼
- Create: `src/app/(app)/account/password/_components/change-password-form.tsx` — POST `/api/auth/change-password`
- Create: `src/app/(app)/admin/users/page.tsx` — 서버 컴포넌트 `requirePermission(admin.users:view)`
- Create: `src/app/(app)/admin/users/_components/users-list.tsx` — 목록·필터·페이지네이션·PENDING 배지·승인/거절 모달
- Create: `src/app/(app)/admin/users/_components/approve-modal.tsx` — 승인(고용형태·직무·역할 확정)/거절
- Create: `src/app/(app)/admin/users/_components/user-fields.tsx` — 고용형태·직무·역할 체크리스트 공용 폼 조각
- Create: `src/app/(app)/admin/users/_components/labels.ts` — enum/역할 한글 라벨·옵션 상수(좁은 union)
- Create: `src/app/(app)/admin/users/new/page.tsx` — 서버 게이트 `admin.users:view` + 클라이언트 폼
- Create: `src/app/(app)/admin/users/new/_components/create-user-form.tsx` — POST `/api/admin/users`
- Create: `src/app/(app)/admin/users/[id]/page.tsx` — 서버 게이트 `admin.users:view` + 상세 클라이언트
- Create: `src/app/(app)/admin/users/[id]/_components/user-edit.tsx` — 속성·systemRole·상태·역할·비번재설정
- Create: `src/app/(app)/admin/users/[id]/_components/override-panel.tsx` — `UserPermissionOverride` CRUD
- Modify: `src/app/(app)/admin/admin-links.tsx` — `/admin/users` href 연결(Link)
- Create: `tests/app/admin/users/labels.test.ts` — 라벨 상수 완전성(enum 누락 가드)
- Create: `tests/app/admin/users/payload.test.ts` — 폼 상태 → API 페이로드 변환 단위 검증

## Prep
- entrypoint §Shared Contracts: **S7**(service 시그니처 — UI가 호출할 API의 입력/출력 모양), **S9**(세션 무효화·`mustChangePassword` 중앙 게이트 — `SessionUser.mustChangePassword`·must-change면 빈 summary), **S10**(토큰 TTL은 메일이 담당, UI는 안내만), **S11**(finding E — 상태 토글은 `PATCH`가 아니라 `POST .../[id]/status`로 `{status}`를 보낸다).
- spec **섹션 7**(화면 전체), **섹션 8**(API 계약 표 — 라우트·메서드·응답), **섹션 8 개인 override 패널**(입력 = 권한키·effect·scope·reason·startsAt/endsAt, scope 의미 노트), **섹션 6**(UI↔API 키 일치·메뉴 숨김은 UX).
- 패턴 참조(인라인됨, 재읽기 불필요):
  - login server action + Card/Input/Label/Button: `src/app/login/page.tsx`
  - 서버 게이트(`hasPermission`/`getPermissionSummary`) + 클라이언트 분리: `src/app/(app)/admin/page.tsx`·`admin-links.tsx`·`src/app/(app)/leave/page.tsx`·`src/app/(app)/workflows/page.tsx`
  - 목록·필터·react-query·테이블: `src/app/(app)/leave/_components/admin-history.tsx`·`workflows-list.tsx`
  - 모달: `src/app/(app)/leave/_components/modal.tsx`·`create-leave-modal.tsx`
  - select·체크박스·useMutation: `leave-fields.tsx`·`create-leave-modal.tsx`·`user-select.tsx`
  - `useCan`: `src/lib/auth/permissions-client.tsx`; react-query Provider는 `(app)/providers.tsx`가 이미 감싼다.
  - UI 프리미티브: `src/components/ui/{button,card,input,label,badge,textarea}.tsx`(import 경로·props 확인됨).
  - 권한 카탈로그(클라이언트 import 가능, 순수 상수): `src/kernel/access/catalog.ts`의 `RESOURCES`·`ACTIONS`.
  - 역할 키: `prisma/seed-roles.ts`(비특권 4종 `regular-developer`/`contractor-developer`/`contractor-content`/`contractor-civil-response`) + 특권 `pm`/`admin`(서버가 OWNER-only 가드).

## Deps
- **05** (admin API 라우트): `GET/POST /api/admin/users`, `GET/PATCH /api/admin/users/[id]`, `POST .../[id]/status`(상태 토글 — finding E), `POST .../approve|reject|roles|reset-password`, `POST/DELETE .../overrides`. 응답 모양은 S7 service 반환을 따른다.
- **06** (자가가입·verify/set-password): `POST /api/auth/signup`, `GET/POST /api/auth/verify-email`, `POST /api/auth/resend-verification`.
- **07** (비번변경·세션무효화·중앙게이트): `POST /api/auth/change-password`, `SessionUser.mustChangePassword`(types.ts).

> 이 task는 **API를 구현하지 않는다**. 각 fetch의 계약(메서드·바디·상태코드)은 위 task가 확정한 것을 호출만 한다. `npm run build`/`typecheck`는 통과하되, 라우트 통합 동작은 task-09 + 수동 검증으로 확인한다.

## Steps

### 1. 라벨/옵션 상수 + 완전성 테스트

`src/app/(app)/admin/users/_components/labels.ts` — enum·역할 한글 라벨을 **좁은 union**으로 손수 작성한다(workflows `labels.ts` 패턴). enum 값 추가 시 여기 누락하면 typecheck가 깨지도록 `Record<리터럴유니온, ...>`로 강제한다.

```ts
import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

export type UserStatusKey = "PENDING" | "INVITED" | "ACTIVE" | "DISABLED" | "REJECTED";

export const STATUS_LABEL: Record<UserStatusKey, string> = {
  PENDING: "승인 대기",
  INVITED: "초대됨",
  ACTIVE: "활성",
  DISABLED: "비활성",
  REJECTED: "거절됨",
};
export const STATUS_VARIANT: Record<UserStatusKey, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  INVITED: "outline",
  ACTIVE: "default",
  DISABLED: "outline",
  REJECTED: "destructive",
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  REGULAR: "정규직",
  CONTRACTOR: "외주",
};
export const JOB_LABEL: Record<JobFunction, string> = {
  PM: "PM",
  DEVELOPER: "개발",
  CONTENT_MANAGER: "콘텐츠",
  CIVIL_RESPONSE: "민원대응",
};
export const SYSTEM_ROLE_LABEL: Record<SystemRole, string> = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
};

export const EMPLOYMENT_OPTIONS = Object.keys(EMPLOYMENT_LABEL) as EmploymentType[];
export const JOB_OPTIONS = Object.keys(JOB_LABEL) as JobFunction[];
// systemRole 부여 옵션: OWNER/ADMIN은 OWNER만 부여 가능(서버 D12 가드) — UI는 전부 노출하되 서버가 거부.
export const SYSTEM_ROLE_OPTIONS = Object.keys(SYSTEM_ROLE_LABEL) as SystemRole[];

// AccessRole 역할 체크리스트 옵션. 특권(pm/admin)은 서버가 OWNER-only 가드(D13ⓑ) — UI는 노출만 하고 검증은 서버.
export const ROLE_OPTIONS: Array<{ key: string; label: string; privileged: boolean }> = [
  { key: "regular-developer", label: "정규 개발자", privileged: false },
  { key: "contractor-developer", label: "외주 개발자", privileged: false },
  { key: "contractor-content", label: "외주 콘텐츠", privileged: false },
  { key: "contractor-civil-response", label: "외주 민원대응", privileged: false },
  { key: "pm", label: "PM(전체권한)", privileged: true },
  { key: "admin", label: "사용자 관리자", privileged: true },
];

// override scope 옵션 — 엔진(computeDecision) 의미를 그대로 따른다(spec 섹션 8 노트).
export const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "전체(all) — ALLOW는 이 값만 전역 허용" },
  { value: "own", label: "본인(own)" },
  { value: "team", label: "팀(team) — ②증분 전까지 미작동" },
  { value: "assigned", label: "배정(assigned)" },
];
```

`tests/app/admin/users/labels.test.ts` — enum 키가 라벨에 모두 존재하는지(누락 가드).

```ts
import { describe, it, expect } from "vitest";
import { STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL, SYSTEM_ROLE_LABEL, ROLE_OPTIONS } from "@/app/(app)/admin/users/_components/labels";

describe("user 관리 라벨 상수", () => {
  it("UserStatus 5값이 모두 라벨·variant를 가진다", () => {
    for (const s of ["PENDING", "INVITED", "ACTIVE", "DISABLED", "REJECTED"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_VARIANT[s]).toBeTruthy();
    }
  });
  it("고용형태·직무·systemRole 라벨이 enum을 덮는다", () => {
    expect(Object.keys(EMPLOYMENT_LABEL)).toEqual(["REGULAR", "CONTRACTOR"]);
    expect(Object.keys(JOB_LABEL)).toEqual(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);
    expect(Object.keys(SYSTEM_ROLE_LABEL)).toEqual(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);
  });
  it("특권 역할(pm·admin)은 privileged=true로 표시된다", () => {
    const priv = ROLE_OPTIONS.filter((r) => r.privileged).map((r) => r.key).sort();
    expect(priv).toEqual(["admin", "pm"]);
  });
});
```

```
npm test -- tests/app/admin/users/labels   # expect FAIL (모듈 미존재)
```

### 2. 공용 폼 조각 + 페이로드 변환 + 테스트

`src/app/(app)/admin/users/_components/user-fields.tsx` — 고용형태·직무·역할 체크리스트(직접추가·승인 모달 공용). select는 leave `leave-fields.tsx`의 `selectCls`를 동일 적용.

```tsx
"use client";
import { Label } from "@/components/ui/label";
import type { EmploymentType, JobFunction } from "@/lib/auth/types";
import { EMPLOYMENT_LABEL, EMPLOYMENT_OPTIONS, JOB_LABEL, JOB_OPTIONS, ROLE_OPTIONS } from "./labels";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface AttrState {
  employmentType: EmploymentType;
  jobFunction: JobFunction;
  roleKeys: string[];
}

export const emptyAttrState: AttrState = {
  employmentType: "REGULAR",
  jobFunction: "DEVELOPER",
  roleKeys: [],
};

export function UserAttrFields({
  state,
  set,
}: {
  state: AttrState;
  set: <K extends keyof AttrState>(k: K, v: AttrState[K]) => void;
}) {
  const toggleRole = (key: string) =>
    set("roleKeys", state.roleKeys.includes(key) ? state.roleKeys.filter((k) => k !== key) : [...state.roleKeys, key]);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>고용형태</Label>
          <select className={selectCls} value={state.employmentType} onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>
            {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>직무</Label>
          <select className={selectCls} value={state.jobFunction} onChange={(e) => set("jobFunction", e.target.value as JobFunction)}>
            {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>역할</Label>
        <div className="grid gap-1.5">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={state.roleKeys.includes(r.key)} onChange={() => toggleRole(r.key)} />
              {r.label}
              {r.privileged ? <span className="text-xs text-muted-foreground">(OWNER만 부여)</span> : null}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
```

`tests/app/admin/users/payload.test.ts` — override 폼 상태 → 페이로드 변환만 순수 함수로 검증(아래 step 7에서 정의하는 `toOverridePayload`).

```ts
import { describe, it, expect } from "vitest";
import { toOverridePayload } from "@/app/(app)/admin/users/[id]/_components/override-panel";

describe("override 폼 페이로드 변환", () => {
  it("빈 startsAt/endsAt/reason은 null로 정규화하고 권한키를 resource/action으로 분해한다", () => {
    expect(toOverridePayload({ permissionKey: "leave.approval:view", effect: "ALLOW", scope: "all", reason: "", startsAt: "", endsAt: "" }))
      .toEqual({ resource: "leave.approval", action: "view", effect: "ALLOW", scope: "all", reason: null, startsAt: null, endsAt: null });
  });
  it("값이 있으면 ISO 문자열로 보낸다", () => {
    const p = toOverridePayload({ permissionKey: "admin.users:view", effect: "DENY", scope: "all", reason: "임시 회수", startsAt: "2026-07-01", endsAt: "2026-07-31" });
    expect(p.resource).toBe("admin.users");
    expect(p.action).toBe("view");
    expect(p.effect).toBe("DENY");
    expect(p.startsAt).toBe("2026-07-01");
    expect(p.endsAt).toBe("2026-07-31");
    expect(p.reason).toBe("임시 회수");
  });
});
```

```
npm test -- tests/app/admin/users   # expect FAIL (override-panel 미존재)
```

### 3. 공개 가입 `src/app/signup/page.tsx`

login 미러. **비밀번호 입력 없음** — 이메일·이름 + 희망 고용형태·직무·부서. server action으로 `/api/auth/signup`에 POST하고, 성공 시 안내 페이지로 리다이렉트(`?sent=1`). 중복/레이트리밋은 중립 안내(D10·D18)이므로 server action은 상태코드와 무관하게 "메일을 확인하세요" 안내로 수렴(이메일 존재 여부 노출 금지).

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EMPLOYMENT_LABEL, EMPLOYMENT_OPTIONS, JOB_LABEL, JOB_OPTIONS } from "@/app/(app)/admin/users/_components/labels";

const selectCls = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    // 결과 메시지는 항상 중립(존재 여부·레이트리밋 노출 금지, D10·D18). 실패해도 안내로 수렴.
    await fetch(`${origin}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? ""),
        employmentType: String(formData.get("employmentType") ?? "REGULAR"),
        jobFunction: String(formData.get("jobFunction") ?? "DEVELOPER"),
        department: String(formData.get("department") ?? "") || null,
      }),
    }).catch(() => undefined);
    redirect("/signup?sent=1");
  }

  return (
    <main className="mx-auto mt-[8vh] w-full max-w-sm px-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
        <p className="text-sm text-muted-foreground">계정 신청</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>회원가입 신청</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="grid gap-2 text-sm">
              <p>입력하신 이메일로 <strong>비밀번호 설정·검증 메일</strong>을 보냈습니다.</p>
              <p className="text-muted-foreground">메일의 링크에서 비밀번호를 설정한 뒤, 관리자 승인이 완료되면 로그인할 수 있습니다.</p>
              <a href="/login" className="text-primary underline-offset-4 hover:underline">로그인 화면으로</a>
            </div>
          ) : (
            <form action={submit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="email">이메일</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="name">이름</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="employmentType">희망 고용형태</Label>
                <select id="employmentType" name="employmentType" className={selectCls} defaultValue="REGULAR">
                  {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="jobFunction">희망 직무</Label>
                <select id="jobFunction" name="jobFunction" className={selectCls} defaultValue="DEVELOPER">
                  {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="department">부서(선택)</Label>
                <Input id="department" name="department" />
              </div>
              <p className="text-xs text-muted-foreground">고용형태·직무·부서는 희망값이며 관리자 승인 시 확정됩니다.</p>
              <Button type="submit">신청하고 검증 메일 받기</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

> 검증: `npm run build` 통과 + (DB 연결 시) `/signup` 진입·제출 → `?sent=1` 안내 표시. signup은 비-`(app)` 공개 라우트(login과 동일 레이아웃 그룹) — `middleware.ts`가 미인증 접근을 허용해야 한다(task-06이 공개 경로로 등록; UI는 의존만).

### 4. 비번 설정/검증 `src/app/verify-email/`

서버 컴포넌트가 토큰 쿼리를 받아 **GET `/api/auth/verify-email?token=`로 유효성 확인**(task-06 계약), 유효하면 비번 설정 폼(클라이언트) 렌더, 무효/만료면 재발송 안내.

`src/app/verify-email/page.tsx`:

```tsx
import { headers } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./_components/set-password-form";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let valid = false;
  if (token) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const res = await fetch(`${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).catch(() => null);
    valid = res?.ok ?? false;
  }

  return (
    <main className="mx-auto mt-[10vh] w-full max-w-sm px-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-semibold tracking-tight">ops-hub</span>
        <span className="h-1 w-10 rounded-full bg-brand" aria-hidden />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 설정</CardTitle>
        </CardHeader>
        <CardContent>
          {valid && token ? (
            <SetPasswordForm token={token} />
          ) : (
            <div className="grid gap-2 text-sm">
              <p className="text-destructive">링크가 만료되었거나 올바르지 않습니다.</p>
              <p className="text-muted-foreground">검증 메일을 다시 받으려면 회원가입을 다시 신청하세요.</p>
              <a href="/signup" className="text-primary underline-offset-4 hover:underline">회원가입 신청</a>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

`src/app/verify-email/_components/set-password-form.tsx` — POST `/api/auth/verify-email`(token + password). 비번 정책 12자+ 안내, 확인 일치 검사(클라이언트), 성공 시 로그인 안내.

```tsx
"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function SetPasswordForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const tooShort = pw.length > 0 && pw.length < 12;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSubmit = pw.length >= 12 && pw === pw2 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: pw }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) setDone(true);
    else setError("비밀번호를 설정하지 못했습니다. 링크가 만료되었을 수 있습니다.");
  }

  if (done)
    return (
      <div className="grid gap-2 text-sm">
        <p>비밀번호가 설정되었습니다.</p>
        <p className="text-muted-foreground">관리자 승인이 완료되면 로그인할 수 있습니다.</p>
        <a href="/login" className="text-primary underline-offset-4 hover:underline">로그인 화면으로</a>
      </div>
    );

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="pw">비밀번호 (12자 이상)</Label>
        <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={tooShort} />
        {tooShort ? <p className="text-xs text-destructive">12자 이상이어야 합니다.</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw2">비밀번호 확인</Label>
        <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={mismatch} />
        {mismatch ? <p className="text-xs text-destructive">비밀번호가 일치하지 않습니다.</p> : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" disabled={!canSubmit} onClick={submit}>{busy ? "설정 중…" : "비밀번호 설정"}</Button>
    </div>
  );
}
```

```
npm run build   # verify-email 라우트 컴파일 확인
```

### 5. 강제/자가 비번변경 `src/app/(app)/account/password/`

`(app)` 그룹 안. must-change 사용자도 도달 가능해야 한다(중앙 게이트 allowlist = `change-password` 경로, S9/D17). 서버 컴포넌트는 세션만 확인하고(권한 summary와 무관), `mustChangePassword`면 강제 안내 문구를 표시.

`src/app/(app)/account/password/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./_components/change-password-form";

export default async function AccountPasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const mustChange = session.user.mustChangePassword;

  return (
    <section className="mx-auto w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
        </CardHeader>
        <CardContent>
          {mustChange ? (
            <p className="mb-3 text-sm text-muted-foreground">
              임시 비밀번호로 로그인했습니다. 계속하려면 비밀번호를 변경하세요.
            </p>
          ) : null}
          <ChangePasswordForm mustChange={mustChange} />
        </CardContent>
      </Card>
    </section>
  );
}
```

`src/app/(app)/account/password/_components/change-password-form.tsx` — POST `/api/auth/change-password`(currentPassword + newPassword). 성공 시 세션 무효화(S9)되므로 로그인 화면으로 이동.

```tsx
"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = pw.length > 0 && pw.length < 12;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSubmit = current.length > 0 && pw.length >= 12 && pw === pw2 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: pw }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      // 변경 후 기존 세션 무효화(S9·D15) — 로그아웃 후 재로그인 유도.
      window.location.href = "/login?changed=1";
    } else if (res?.status === 400 || res?.status === 401) {
      setError("현재 비밀번호가 올바르지 않거나 새 비밀번호가 정책에 맞지 않습니다.");
    } else {
      setError("비밀번호를 변경하지 못했습니다.");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="current">{mustChange ? "임시 비밀번호" : "현재 비밀번호"}</Label>
        <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw">새 비밀번호 (12자 이상)</Label>
        <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={tooShort} />
        {tooShort ? <p className="text-xs text-destructive">12자 이상이어야 합니다.</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw2">새 비밀번호 확인</Label>
        <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={mismatch} />
        {mismatch ? <p className="text-xs text-destructive">비밀번호가 일치하지 않습니다.</p> : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" disabled={!canSubmit} onClick={submit}>{busy ? "변경 중…" : "비밀번호 변경"}</Button>
    </div>
  );
}
```

> 검증: `mustChange`면 "임시 비밀번호" 라벨·강제 안내가 보인다. 자가변경이면 "현재 비밀번호". 두 경로 모두 같은 폼. 미들웨어가 must-change 세션을 이 경로로 리다이렉트하는 것은 task-07 책임(UI는 폼만 제공).

### 6. 사용자 목록 `src/app/(app)/admin/users/page.tsx` + 클라이언트

서버 컴포넌트: `requirePermission(admin.users:view)` 게이트(미보유 redirect). 권한 키 일치를 위해 `getPermissionSummary`로 `canCreate`/`canUpdate`/`canApprove`를 계산해 클라이언트에 전달(메뉴/버튼 노출 판정 — 실행 권한은 API가 재검사).

`src/app/(app)/admin/users/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UsersList } from "./_components/users-list";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 관리</h1>
      <UsersList
        canCreate={keys.has("admin.users:create")}
        canUpdate={keys.has("admin.users:update")}
        canApprove={keys.has("admin.users:approve")}
      />
    </section>
  );
}
```

`src/app/(app)/admin/users/_components/users-list.tsx` — react-query 목록, 상태/고용형태/직무/검색 필터, 페이지네이션, PENDING 배지(목록 응답의 `pendingCount`), PENDING 행은 승인/거절 모달 진입, 그 외 행은 편집 링크.

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import {
  STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL,
  EMPLOYMENT_OPTIONS, JOB_OPTIONS, type UserStatusKey,
} from "./labels";
import { ApproveModal } from "./approve-modal";

const selectCls = "h-8 rounded-lg border border-input bg-background px-2.5 text-sm";
const PAGE_SIZE = 20;

interface Row {
  id: string; email: string; name: string; status: UserStatusKey;
  employmentType: keyof typeof EMPLOYMENT_LABEL; jobFunction: keyof typeof JOB_LABEL;
  systemRole: string; department: string | null; roleKeys: string[];
}
interface ListResponse { rows: Row[]; total: number; pendingCount: number; }

const STATUS_FILTER: Array<"ALL" | UserStatusKey> = ["ALL", "PENDING", "ACTIVE", "DISABLED", "REJECTED"];

async function fetchUsers(params: URLSearchParams): Promise<ListResponse> {
  const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`users ${res.status}`);
  return res.json();
}

export function UsersList({ canCreate, canUpdate, canApprove }: { canCreate: boolean; canUpdate: boolean; canApprove: boolean }) {
  const [status, setStatus] = useState<"ALL" | UserStatusKey>("ALL");
  const [employmentType, setEmploymentType] = useState("");
  const [jobFunction, setJobFunction] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [approveTarget, setApproveTarget] = useState<Row | null>(null);

  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (employmentType) params.set("employmentType", employmentType);
  if (jobFunction) params.set("jobFunction", jobFunction);
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-users", status, employmentType, jobFunction, q, page],
    queryFn: () => fetchUsers(params),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pendingCount = data?.pendingCount ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const reset = () => setPage(1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pendingCount > 0 ? (
          <button type="button" onClick={() => { setStatus("PENDING"); reset(); }} className="contents">
            <Badge variant="secondary">승인 대기 {pendingCount}건</Badge>
          </button>
        ) : null}
        <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value as "ALL" | UserStatusKey); reset(); }}>
          {STATUS_FILTER.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s]}</option>)}
        </select>
        <select className={selectCls} value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); reset(); }}>
          <option value="">전체 고용형태</option>
          {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
        </select>
        <select className={selectCls} value={jobFunction} onChange={(e) => { setJobFunction(e.target.value); reset(); }}>
          <option value="">전체 직무</option>
          {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
        </select>
        <Input className="w-44" placeholder="이름/이메일 검색" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        {canCreate ? (
          <Link href="/admin/users/new" className={buttonVariants({ size: "sm" }) + " ml-auto"}>+ 직접 추가</Link>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">불러오지 못했습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2">이름</th>
                <th className="p-2">이메일</th>
                <th className="p-2">상태</th>
                <th className="p-2">고용형태</th>
                <th className="p-2">직무</th>
                <th className="p-2">역할</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="p-2">{u.name}</td>
                  <td className="p-2 text-muted-foreground">{u.email}</td>
                  <td className="p-2"><Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge></td>
                  <td className="p-2">{EMPLOYMENT_LABEL[u.employmentType]}</td>
                  <td className="p-2">{JOB_LABEL[u.jobFunction]}</td>
                  <td className="p-2 text-muted-foreground">{u.roleKeys.join(", ") || "-"}</td>
                  <td className="p-2 text-right">
                    {u.status === "PENDING" && canApprove ? (
                      <Button size="sm" variant="ghost" onClick={() => setApproveTarget(u)}>승인·거절</Button>
                    ) : canUpdate ? (
                      <Link href={`/admin/users/${u.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>편집</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">사용자가 없습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>총 {total}명</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span>{page} / {lastPage}</span>
          <Button size="sm" variant="outline" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      </div>

      {approveTarget ? (
        <ApproveModal target={approveTarget} onClose={() => setApproveTarget(null)} onDone={() => { setApproveTarget(null); refetch(); }} />
      ) : null}
    </div>
  );
}
```

```
npm run build && npm run lint   # 목록 컴파일·boundaries 확인
```

### 7. 승인/거절 모달 `_components/approve-modal.tsx`

PENDING 행에서 고용형태·직무·역할(체크리스트) 확정 → POST `/api/admin/users/[id]/approve`. 거절 → POST `/api/admin/users/[id]/reject`(reason). leave `Modal` 재사용.

```tsx
"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/app/(app)/leave/_components/modal";
import { UserAttrFields, type AttrState } from "./user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS } from "./labels";
import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

interface Target { id: string; name: string; email: string; employmentType: EmploymentType; jobFunction: JobFunction; }

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export function ApproveModal({ target, onClose, onDone }: { target: Target; onClose: () => void; onDone: () => void }) {
  const [attr, setAttr] = useState<AttrState>({ employmentType: target.employmentType, jobFunction: target.jobFunction, roleKeys: [] });
  const [systemRole, setSystemRole] = useState<SystemRole>("MEMBER");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  const approve = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${target.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employmentType: attr.employmentType, jobFunction: attr.jobFunction, systemRole, roleKeys: attr.roleKeys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `승인 실패 (${res.status})`);
    },
    onSuccess: onDone,
  });
  const reject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${target.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `거절 실패 (${res.status})`);
    },
    onSuccess: onDone,
  });
  const err = (approve.error ?? reject.error) as Error | undefined;

  return (
    <Modal title={`신청 처리 — ${target.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{target.email}</p>
      {rejecting ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>거절 사유</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {err ? <p className="text-sm text-destructive">{err.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)}>뒤로</Button>
            <Button variant="destructive" disabled={reject.isPending} onClick={() => reject.mutate()}>{reject.isPending ? "거절 중…" : "거절"}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <UserAttrFields state={attr} set={set} />
          <div className="space-y-1">
            <Label>systemRole</Label>
            <select className={selectCls} value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
              {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">OWNER·ADMIN 부여는 OWNER만 가능합니다(서버 검증).</p>
          </div>
          {err ? <p className="text-sm text-destructive">{err.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(true)}>거절</Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? "승인 중…" : "승인"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

### 8. 직접추가 `admin/users/new`

서버 게이트(`admin.users:view`, 실제 생성은 `:create`를 API가 검사) + 클라이언트 폼. 이메일·이름·임시비번·고용형태·직무·부서·역할 → POST `/api/admin/users`.

`src/app/(app)/admin/users/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { CreateUserForm } from "./_components/create-user-form";

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:create")) redirect("/admin/users");

  return (
    <section className="mx-auto w-full max-w-lg space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 직접 추가</h1>
      <CreateUserForm />
    </section>
  );
}
```

`src/app/(app)/admin/users/new/_components/create-user-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UserAttrFields, emptyAttrState, type AttrState } from "../../_components/user-fields";
import { SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS } from "../../_components/labels";
import type { SystemRole } from "@/lib/auth/types";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

export function CreateUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [department, setDepartment] = useState("");
  const [systemRole, setSystemRole] = useState<SystemRole>("MEMBER");
  const [attr, setAttr] = useState<AttrState>(emptyAttrState);
  const set = <K extends keyof AttrState>(k: K, v: AttrState[K]) => setAttr((s) => ({ ...s, [k]: v }));

  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, name, tempPassword, department: department || null,
          employmentType: attr.employmentType, jobFunction: attr.jobFunction, systemRole, roleKeys: attr.roleKeys,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `추가 실패 (${res.status})`);
    },
    onSuccess: () => router.push("/admin/users"),
  });

  const canSubmit = email && name && tempPassword.length >= 12 && !m.isPending;
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">이름</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="temp">임시 비밀번호 (12자 이상)</Label>
          <Input id="temp" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} aria-invalid={tempPassword.length > 0 && tempPassword.length < 12} />
          <p className="text-xs text-muted-foreground">추가 후 사용자는 최초 로그인 시 비밀번호를 변경해야 합니다.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="dept">부서(선택)</Label>
          <Input id="dept" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
        <UserAttrFields state={attr} set={set} />
        <div className="space-y-1">
          <Label>systemRole</Label>
          <select className={selectCls} value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
            {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
          </select>
        </div>
        {m.isError ? <p className="text-sm text-destructive">{(m.error as Error).message}</p> : null}
        <div className="flex justify-end">
          <Button disabled={!canSubmit} onClick={() => m.mutate()}>{m.isPending ? "추가 중…" : "추가"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 9. 편집 `admin/users/[id]` + override 패널

서버 게이트(`admin.users:view`) + 상세 클라이언트. 속성·systemRole(OWNER 부여는 서버 가드)·상태 토글(disable/enable)·역할 체크리스트·비번 재설정·override 패널.

`src/app/(app)/admin/users/[id]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { UserEdit } from "./_components/user-edit";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const keys = new Set((await getPermissionSummary(session.user.id)).keys);
  if (!keys.has("admin.users:view")) redirect("/dashboard");
  const { id } = await params;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">사용자 편집</h1>
      <UserEdit userId={id} canUpdate={keys.has("admin.users:update")} />
    </section>
  );
}
```

`src/app/(app)/admin/users/[id]/_components/user-edit.tsx` — `GET /api/admin/users/[id]` 상세 로드 → 속성/systemRole PATCH·역할 POST·상태 토글·비번 재설정. 비-update 권한이면 읽기전용.

```tsx
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABEL, STATUS_VARIANT, SYSTEM_ROLE_LABEL, SYSTEM_ROLE_OPTIONS, ROLE_OPTIONS, type UserStatusKey,
} from "../../_components/labels";
import { EMPLOYMENT_LABEL, EMPLOYMENT_OPTIONS, JOB_LABEL, JOB_OPTIONS } from "../../_components/labels";
import { OverridePanel, type OverrideRow } from "./override-panel";
import type { EmploymentType, JobFunction, SystemRole } from "@/lib/auth/types";

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

interface Detail {
  id: string; email: string; name: string; status: UserStatusKey;
  employmentType: EmploymentType; jobFunction: JobFunction; systemRole: SystemRole;
  department: string | null; roleKeys: string[]; overrides: OverrideRow[];
}

async function fetchDetail(id: string): Promise<Detail> {
  const res = await fetch(`/api/admin/users/${id}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`detail ${res.status}`);
  return res.json();
}

export function UserEdit({ userId, canUpdate }: { userId: string; canUpdate: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-users", userId], queryFn: () => fetchDetail(userId) });

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">불러오지 못했습니다.</p>;
  return <UserEditInner key={data.id} detail={data} canUpdate={canUpdate} invalidate={() => qc.invalidateQueries({ queryKey: ["admin-users", userId] })} />;
}

function UserEditInner({ detail, canUpdate, invalidate }: { detail: Detail; canUpdate: boolean; invalidate: () => void }) {
  const [name, setName] = useState(detail.name);
  const [department, setDepartment] = useState(detail.department ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(detail.employmentType);
  const [jobFunction, setJobFunction] = useState<JobFunction>(detail.jobFunction);
  const [systemRole, setSystemRole] = useState<SystemRole>(detail.systemRole);
  const [roleKeys, setRoleKeys] = useState<string[]>(detail.roleKeys);
  const [error, setError] = useState<string | null>(null);

  const call = async (input: RequestInfo, init: RequestInit, okFail: string) => {
    setError(null);
    const res = await fetch(input, init).catch(() => null);
    if (!res || !res.ok) {
      setError((res && (await res.json().catch(() => ({}))).error) || okFail);
      return false;
    }
    invalidate();
    return true;
  };

  const saveAttrs = useMutation({
    mutationFn: () => call(`/api/admin/users/${detail.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, department: department || null, employmentType, jobFunction, systemRole }),
    }, "저장 실패"),
  });
  const saveRoles = useMutation({
    mutationFn: () => call(`/api/admin/users/${detail.id}/roles`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleKeys }),
    }, "역할 저장 실패"),
  });
  const toggleStatus = useMutation({
    mutationFn: () => {
      const next = detail.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
      // finding E — 상태 토글은 PATCH(프로필·systemRole 전용)가 아니라 전용 status 라우트로 POST한다.
      // PATCH로 {status}를 보내면 zod가 unknown 키를 strip해 빈 patch가 되어 무시되고, 세션무효화(D14)도 일어나지 않는다.
      return call(`/api/admin/users/${detail.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      }, "상태 변경 실패");
    },
  });
  const resetPw = useMutation({
    mutationFn: () => call(`/api/admin/users/${detail.id}/reset-password`, { method: "POST" }, "재설정 실패"),
  });

  const toggleRole = (key: string) => setRoleKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const ro = !canUpdate;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {detail.email}
            <Badge variant={STATUS_VARIANT[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={ro} />
          </div>
          <div className="grid gap-1.5">
            <Label>부서</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} disabled={ro} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>고용형태</Label>
              <select className={selectCls} value={employmentType} disabled={ro} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
                {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>직무</Label>
              <select className={selectCls} value={jobFunction} disabled={ro} onChange={(e) => setJobFunction(e.target.value as JobFunction)}>
                {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>systemRole</Label>
            <select className={selectCls} value={systemRole} disabled={ro} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
              {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">OWNER·ADMIN 부여·마지막 OWNER 강등은 서버가 거부할 수 있습니다.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {canUpdate ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={resetPw.isPending} onClick={() => resetPw.mutate()}>비밀번호 재설정</Button>
              <Button variant={detail.status === "ACTIVE" ? "destructive" : "secondary"} disabled={toggleStatus.isPending || detail.status === "PENDING" || detail.status === "REJECTED"} onClick={() => toggleStatus.mutate()}>
                {detail.status === "ACTIVE" ? "비활성화" : "활성화"}
              </Button>
              <Button disabled={saveAttrs.isPending} onClick={() => saveAttrs.mutate()}>{saveAttrs.isPending ? "저장 중…" : "속성 저장"}</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>역할</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={roleKeys.includes(r.key)} disabled={ro} onChange={() => toggleRole(r.key)} />
              {r.label}{r.privileged ? <span className="text-xs text-muted-foreground">(OWNER만 부여)</span> : null}
            </label>
          ))}
          {canUpdate ? (
            <div className="flex justify-end">
              <Button size="sm" disabled={saveRoles.isPending} onClick={() => saveRoles.mutate()}>{saveRoles.isPending ? "저장 중…" : "역할 저장"}</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <OverridePanel userId={detail.id} overrides={detail.overrides} canUpdate={canUpdate} onChanged={invalidate} />
    </div>
  );
}
```

`src/app/(app)/admin/users/[id]/_components/override-panel.tsx` — `UserPermissionOverride` CRUD. 권한키 선택기는 `RESOURCES × ACTIONS`(catalog)에서 합성. effect·scope·reason·startsAt/endsAt. 기존 override 목록(유효기간·만료 표시) + 추가/삭제. `toOverridePayload`는 step 2 테스트 대상이므로 export.

```tsx
"use client";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RESOURCES, ACTIONS } from "@/kernel/access/catalog";
import { SCOPE_OPTIONS } from "../../_components/labels";

export interface OverrideRow {
  id: string; resource: string; action: string; effect: "ALLOW" | "DENY"; scope: string;
  reason: string | null; startsAt: string | null; endsAt: string | null;
}

export interface OverrideFormState {
  permissionKey: string; effect: "ALLOW" | "DENY"; scope: string; reason: string; startsAt: string; endsAt: string;
}

// 폼 상태 → POST 페이로드. 빈 문자열은 null로, 권한키는 resource/action으로 분해. (step 2 단위테스트 대상)
export function toOverridePayload(s: OverrideFormState) {
  const idx = s.permissionKey.lastIndexOf(":");
  return {
    resource: s.permissionKey.slice(0, idx),
    action: s.permissionKey.slice(idx + 1),
    effect: s.effect,
    scope: s.scope,
    reason: s.reason || null,
    startsAt: s.startsAt || null,
    endsAt: s.endsAt || null,
  };
}

const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("ko-KR") : "-");

export function OverridePanel({ userId, overrides, canUpdate, onChanged }: { userId: string; overrides: OverrideRow[]; canUpdate: boolean; onChanged: () => void }) {
  const keyOptions = useMemo(
    () => RESOURCES.flatMap((r) => ACTIONS.map((a) => `${r}:${a}`)),
    [],
  );
  const [form, setForm] = useState<OverrideFormState>({ permissionKey: keyOptions[0], effect: "ALLOW", scope: "all", reason: "", startsAt: "", endsAt: "" });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof OverrideFormState>(k: K, v: OverrideFormState[K]) => setForm((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(`/api/admin/users/${userId}/overrides`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toOverridePayload(form)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `추가 실패 (${res.status})`);
    },
    onSuccess: onChanged,
    onError: (e) => setError((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async (overrideId: string) => {
      const res = await fetch(`/api/admin/users/${userId}/overrides`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overrideId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `삭제 실패 (${res.status})`);
    },
    onSuccess: onChanged,
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>개인 권한 예외 (override)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1.5 text-sm">
          {overrides.length === 0 ? <li className="text-muted-foreground">등록된 예외가 없습니다.</li> : null}
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <Badge variant={o.effect === "DENY" ? "destructive" : "default"}>{o.effect}</Badge>
              <span className="font-medium">{o.resource}:{o.action}</span>
              <span className="text-xs text-muted-foreground">scope={o.scope} · {fmt(o.startsAt)} ~ {fmt(o.endsAt)}</span>
              {o.reason ? <span className="text-xs text-muted-foreground">· {o.reason}</span> : null}
              {canUpdate ? (
                <Button className="ml-auto" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(o.id)}>삭제</Button>
              ) : null}
            </li>
          ))}
        </ul>

        {canUpdate ? (
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>권한 키</Label>
                <select className={selectCls} value={form.permissionKey} onChange={(e) => set("permissionKey", e.target.value)}>
                  {keyOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>effect</Label>
                <select className={selectCls} value={form.effect} onChange={(e) => set("effect", e.target.value as "ALLOW" | "DENY")}>
                  <option value="ALLOW">ALLOW</option>
                  <option value="DENY">DENY</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>scope</Label>
                <select className={selectCls} value={form.scope} onChange={(e) => set("scope", e.target.value)}>
                  {SCOPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>사유(선택)</Label>
                <Input value={form.reason} onChange={(e) => set("reason", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>시작(선택)</Label>
                <Input type="date" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>종료(선택)</Label>
                <Input type="date" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">ALLOW는 scope=all만 전역 허용으로 인정됩니다. team scope는 ②증분 전까지 미작동입니다.</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end">
              <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? "추가 중…" : "예외 추가"}</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

```
npm test -- tests/app/admin/users   # expect PASS (labels·payload)
npm run build && npm run lint && npm run typecheck
```

### 10. `admin-links.tsx`에 `/admin/users` 연결

기존 텍스트 `<li>사용자</li>`를 `/admin/users` Link로 교체. Button은 쓰지 않고 plain Link(메뉴 항목). 감사 로그는 본 증분 범위 밖이므로 텍스트 유지.

```tsx
"use client";

import Link from "next/link";
import { useCan } from "@/lib/auth/permissions-client";

export function AdminLinks() {
  const canAudit = useCan("admin.audit", "view");
  const canUsers = useCan("admin.users", "view");
  return (
    <ul className="grid gap-1 text-sm">
      {canUsers ? (
        <li>
          <Link href="/admin/users" className="text-primary underline-offset-4 hover:underline">
            사용자
          </Link>
        </li>
      ) : null}
      {canAudit ? <li className="text-muted-foreground">감사 로그</li> : null}
    </ul>
  );
}
```

```
npm run build && npm run lint && npm run typecheck   # 전체 그린
```

### 11. 커밋

```
git add src/app/signup src/app/verify-email "src/app/(app)/account" "src/app/(app)/admin/users" "src/app/(app)/admin/admin-links.tsx" tests/app/admin/users
git commit -m "feat(user-mgmt): 사용자 관리 UI(가입·검증·강제변경·목록·승인모달·직접추가·편집·override·nav) 추가(spec §7)"
```

## Acceptance Criteria
- `npm run typecheck` → 그린(에러 0). 라벨 union·`SessionUser.mustChangePassword`(task-07 추가) 참조가 컴파일된다.
- `npm run lint` → 그린(boundaries 위반 0). UI 컴포넌트는 `@/kernel/access/catalog`(순수 상수)·`@/lib/auth/types`만 import하고 repository/service를 직접 import하지 않는다.
- `npm run build` → 성공(`/signup`·`/verify-email`·`/account/password`·`/admin/users`·`/admin/users/new`·`/admin/users/[id]` 라우트 컴파일).
- `npm test -- tests/app/admin/users` → PASS. 기대출력: `labels` 3 케이스 + `payload` 2 케이스 모두 통과.
- `npm test` 전체 → PASS(기존 회귀 없음).
- 수동 검증(DB 연결 시, task-05/06/07 머지 후):
  - `/signup` 제출 → `?sent=1` 중립 안내; DB에 PENDING 행 + 검증 메일 enqueue 확인(task-06 동작).
  - 검증 메일 링크 `/verify-email?token=…` → 비번 설정 폼 → 설정 후 "승인 대기" 안내.
  - `admin.users:view` 보유자로 `/admin/users` 진입 → 목록·필터·페이지네이션·PENDING 배지. 미보유자는 `/dashboard`로 리다이렉트.
  - PENDING 행 "승인·거절" → 모달에서 고용형태·직무·역할·systemRole 확정 → 승인 시 목록에서 ACTIVE로 갱신.
  - 편집 화면에서 속성/역할 저장·비활성화·비번 재설정·override 추가/삭제가 각각 API 호출로 반영.

## Cautions
- **Don't `Button`에 `asChild`를 쓰지 마라 — 미지원이다.** Reason: `src/components/ui/button.tsx`는 native `<button>` props만 받는다(`asChild` 없음). 링크를 버튼처럼 보이게 하려면 `<Link className={buttonVariants({ size, variant })}>` 또는 `<a className={buttonVariants(...)}>`를 쓴다(이 task의 "직접 추가"·"편집" 링크가 그 패턴). 새 ui 프리미티브를 만들지 말 것.
- **Don't 메뉴/버튼 숨김을 보안으로 착각하지 마라.** Reason: `useCan`/조건부 렌더는 UX일 뿐이다. 실제 권한은 API가 동일 키(`admin.users:view|create|update|approve`)로 재검사한다(spec 섹션 6·D17). UI는 서버 게이트(`requirePermission`/`getPermissionSummary`)와 **동일 키**를 공유하되, 숨겼다고 안전하다고 가정하지 말 것.
- **Don't 클라이언트에서 D12/D13 가드를 흉내 내 검증을 끝내지 마라.** Reason: 특권 역할(`pm`/`admin`)·OWNER/ADMIN systemRole 부여, 마지막 OWNER/관리자 보존, override 한도는 전부 **서버 서비스 계층**(task-04/05)에서 강제된다. UI는 옵션을 노출하되 "OWNER만 부여" 같은 안내만 표시하고, 거부는 API 403을 그대로 사용자에게 보여준다(중복 가드 작성 금지 — surgical).
- **Don't `account/password`를 권한 summary로 게이트하지 마라.** Reason: must-change 세션은 중앙 게이트(S9/D17)에서 빈 summary를 받으므로, 이 페이지를 `admin.*`/임의 permission으로 막으면 정작 강제변경 사용자가 들어올 수 없다. 세션 존재만 확인하고(`auth()`), allowlist 경로(`change-password`)로서 권한 검사 없이 폼을 렌더한다.
- **Don't signup/verify 결과를 구체적으로 노출하지 마라.** Reason: 중복 이메일(D10)·레이트리밋(D18)은 **중립 메시지**로 수렴해야 한다(이메일 존재 여부·시도 한도 노출 금지). signup server action은 응답 상태와 무관하게 `?sent=1` 안내로 끝내고, verify 실패는 "링크가 만료되었거나 올바르지 않습니다"로 통일한다.
- **Don't 비번 정책 검사를 클라이언트에만 두지 마라.** Reason: 12자+ 일치 검사는 UX 보조일 뿐 권위가 아니다. 서버(zod `min(12)`, task-04/06/07)가 최종 검증한다. 클라이언트 검사를 통과시키되 서버 400을 항상 화면에 반영한다.
- **Don't `tempPassword`/`currentPassword` 같은 비밀값을 로깅하거나 쿼리스트링에 넣지 마라.** Reason: 모두 POST 바디로만 전송한다. signup/verify의 토큰만 쿼리스트링을 쓰고(메일 링크), 비밀번호는 절대 URL에 싣지 않는다.
- **Don't enum 라벨 union을 넓은 `string`으로 바꾸지 마라.** Reason: `STATUS_LABEL`·`EMPLOYMENT_LABEL` 등은 `Record<리터럴유니온, …>`로 손수 좁힌 것이다(workflows `labels.ts` 규약). enum 값이 늘면 여기 누락 시 typecheck가 깨지게 두는 것이 의도다 — `labels.test.ts`가 가드.
- **Don't 새 API 엔드포인트를 만들지 마라.** Reason: 이 task는 task-05/06/07이 확정한 라우트(`/api/admin/users…`·`/api/auth/…`)만 fetch한다. 역할 목록·권한 카탈로그는 서버 호출 없이 정적 상수(`ROLE_OPTIONS`)·`catalog.ts`(`RESOURCES×ACTIONS`)에서 합성한다 — 별도 조회 API 추가 금지(증분 범위 밖).
