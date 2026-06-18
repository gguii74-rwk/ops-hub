# Task 07 — API 라우트: GET /api/admin/settings + PUT /api/admin/settings/[key]

**Purpose:** 설정 목록 조회와 단건 변경 API. GET은 admin 베이스 게이트(listSettings 내부), PUT은 `admin.settings:configure` + 엔트리별 권한 둘 다 통과해야 write. 서비스 에러를 HTTP 상태로 매핑한다.

## Files

- Create: `src/app/api/admin/settings/route.ts` — GET.
- Create: `src/app/api/admin/settings/[key]/route.ts` — PUT.
- Test: `tests/app/api/admin/settings.test.ts`.

## Prep

- spec §5.7·§7.3·§8, entrypoint §SC-3·§SC-7. Phase 1 패턴: `auth()`→`session.user.id`, 401(미인증)/403(`ForbiddenError`).
- `listSettings`는 내부에서 `requirePermission(uid,"admin.settings","view")`(base 게이트) → `ForbiddenError`.

## Deps

- Task 04(`listSettings`/`setSetting`/registry 에러), Task 01(`getEntry`).

## TDD steps

### 1. 실패 테스트 작성 — `tests/app/api/admin/settings.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

let session: any;
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

class FakeForbidden extends Error {}
const requirePermission = vi.fn(async (_u: string, _r: string, _a: string) => {});
vi.mock("@/kernel/access", () => ({ ForbiddenError: FakeForbidden, requirePermission: (...a: any[]) => requirePermission(...a) }));

const listSettings = vi.fn();
const setSetting = vi.fn();
vi.mock("@/kernel/settings", () => ({
  listSettings: (...a: any[]) => listSettings(...a),
  setSetting: (...a: any[]) => setSetting(...a),
}));

vi.mock("@/kernel/settings/catalog", () => ({
  getEntry: (key: string) =>
    key === "integrations.smtp.host"
      ? { kind: "systemSetting", key, permission: { resource: "integrations.smtp", action: "configure" } }
      : undefined,
}));

import {
  UnknownSettingError, SettingNotWritableError, SettingValidationError, SettingConcurrencyError,
} from "@/kernel/settings/registry";
import { GET } from "@/app/api/admin/settings/route";
import { PUT } from "@/app/api/admin/settings/[key]/route";

const putReq = (body: unknown) =>
  new Request("http://t/api/admin/settings/integrations.smtp.host", { method: "PUT", body: JSON.stringify(body) });
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  session = { user: { id: "u1" } };
  requirePermission.mockReset().mockResolvedValue(undefined);
  listSettings.mockReset();
  setSetting.mockReset();
});

describe("GET /api/admin/settings", () => {
  it("미인증 → 401", async () => {
    session = null;
    expect((await GET()).status).toBe(401);
  });
  it("admin 게이트 실패(ForbiddenError) → 403", async () => {
    listSettings.mockRejectedValue(new FakeForbidden());
    expect((await GET()).status).toBe(403);
  });
  it("성공 → 200 + items", async () => {
    listSettings.mockResolvedValue([{ key: "integrations.smtp.host", status: "OK" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("PUT /api/admin/settings/[key]", () => {
  it("미인증 → 401", async () => {
    session = null;
    expect((await PUT(putReq({ value: "x" }), ctx("integrations.smtp.host"))).status).toBe(401);
  });
  it("미등록 key → 404", async () => {
    expect((await PUT(putReq({ value: "x" }), ctx("nope.nope.nope"))).status).toBe(404);
  });
  it("권한 없음(엔트리 게이트 throw) → 403", async () => {
    requirePermission.mockImplementation(async (_u, r) => { if (r === "integrations.smtp") throw new FakeForbidden(); });
    expect((await PUT(putReq({ value: "x" }), ctx("integrations.smtp.host"))).status).toBe(403);
  });
  it("성공 → 200 + updatedAt, base+entry 게이트 모두 호출", async () => {
    setSetting.mockResolvedValue({ updatedAt: new Date(2026, 0, 2) });
    const res = await PUT(putReq({ value: "mail.x", expectedUpdatedAt: null }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("u1", "admin.settings", "configure");
    expect(requirePermission).toHaveBeenCalledWith("u1", "integrations.smtp", "configure");
    expect(setSetting).toHaveBeenCalledWith("integrations.smtp.host", "mail.x", { actorId: "u1", expectedUpdatedAt: null });
  });
  it("Zod 실패 → 422", async () => {
    setSetting.mockRejectedValue(new SettingValidationError("integrations.smtp.host", "bad"));
    expect((await PUT(putReq({ value: 1, expectedUpdatedAt: null }), ctx("integrations.smtp.host"))).status).toBe(422);
  });
  it("concurrency → 409", async () => {
    setSetting.mockRejectedValue(new SettingConcurrencyError("integrations.smtp.host"));
    expect((await PUT(putReq({ value: "x", expectedUpdatedAt: "2020-01-01" }), ctx("integrations.smtp.host"))).status).toBe(409);
  });
  it("not writable → 400", async () => {
    setSetting.mockRejectedValue(new SettingNotWritableError("integrations.smtp.host"));
    expect((await PUT(putReq({ value: "x", expectedUpdatedAt: null }), ctx("integrations.smtp.host"))).status).toBe(400);
  });
  it("expectedUpdatedAt 생략 → 400(LWW 우회 차단), setSetting 미호출", async () => {
    const res = await PUT(putReq({ value: "x" }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
  it("expectedUpdatedAt 형식 오류 → 400", async () => {
    const res = await PUT(putReq({ value: "x", expectedUpdatedAt: "not-a-date" }), ctx("integrations.smtp.host"));
    expect(res.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- "api/admin/settings"
```

기대: `Cannot find module '@/app/api/admin/settings/route'`.

### 3. 구현 — `src/app/api/admin/settings/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/kernel/access";
import { listSettings } from "@/kernel/settings";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const items = await listSettings(session.user.id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
```

### 4. 구현 — `src/app/api/admin/settings/[key]/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError, requirePermission } from "@/kernel/access";
import { setSetting } from "@/kernel/settings";
import { getEntry } from "@/kernel/settings/catalog";
import {
  SettingActorRequiredError,
  SettingConcurrencyError,
  SettingNotWritableError,
  SettingValidationError,
  UnknownSettingError,
} from "@/kernel/settings/registry";

export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { key } = await params;
  const uid = session.user.id;

  const entry = getEntry(key);
  if (!entry) {
    return NextResponse.json({ error: `unknown setting: ${key}` }, { status: 404 });
  }

  try {
    await requirePermission(uid, "admin.settings", "configure");
    await requirePermission(uid, entry.permission.resource, entry.permission.action);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { value, expectedUpdatedAt: rawToken } = body as { value: unknown; expectedUpdatedAt?: unknown };

  // 동시성 토큰은 공개 라우트에서 필수: 명시적 null(최초 생성) 또는 유효 ISO 문자열만 허용.
  // 생략(undefined)은 service의 last-write-wins 경로로 떨어져 409 가드를 우회하므로 400으로 거부(Codex 2차 리뷰 F3).
  let expectedUpdatedAt: Date | null;
  if (rawToken === null) {
    expectedUpdatedAt = null;
  } else if (typeof rawToken === "string") {
    const parsed = new Date(rawToken);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "invalid expectedUpdatedAt" }, { status: 400 });
    }
    expectedUpdatedAt = parsed;
  } else {
    return NextResponse.json({ error: "expectedUpdatedAt required (null or ISO string)" }, { status: 400 });
  }

  try {
    const result = await setSetting(key, value, { actorId: uid, expectedUpdatedAt });
    return NextResponse.json({ updatedAt: result.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnknownSettingError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof SettingNotWritableError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SettingValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof SettingConcurrencyError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SettingActorRequiredError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
```

### 5. 실행 → PASS

```bash
npm test -- "api/admin/settings"
```

기대: GET 3 + PUT 9 = 12 테스트 통과.

### 6. typecheck/lint/build

```bash
npm run typecheck && npm run lint && npm run build
```

기대: build 라우트 목록에 `/api/admin/settings`, `/api/admin/settings/[key]` 등장.

### 7. 커밋

```bash
git add src/app/api/admin/settings tests/app/api/admin/settings.test.ts
git commit -m "Add settings API: GET list and PUT with admin + entry gates"
```

## Acceptance Criteria

- `npm test -- "api/admin/settings"` → 12 PASS.
- `npm run typecheck` / `npm run lint` / `npm run build` → 에러 0, 두 라우트 빌드.
- PUT은 `admin.settings:configure`와 엔트리 권한을 **둘 다** 검사(테스트로 호출 인자 확인).

## Cautions

- **Next 16 라우트의 `params`는 Promise — 반드시 `await params`. 이유:** 동기 접근은 타입/런타임 오류.
- **엔트리 게이트를 빼지 말 것(base 게이트만으로 불충분). 이유:** Codex Finding 3 — 좁은 권한자가 다른 도메인 설정을 못 바꾸게 한다.
- **`expectedUpdatedAt`를 `null` 또는 유효 ISO로 필수 검증(생략·형식오류→400). 이유:** Codex 2차 리뷰 F3 — 토큰을 생략하면 service의 `undefined`(last-write-wins) 경로로 떨어져 공개 라우트에서 409 동시성 가드가 우회된다. LWW는 service 내부 전용으로만 두고 공개 API는 도달 불가하게 한다.
- **응답에 `Cache-Control: no-store`. 이유:** 권한 필터된 설정/상태가 캐시되지 않게(Phase 1 verify 하드닝과 동일 기조).
- **에러 매핑에서 미식별 에러는 rethrow. 이유:** 예기치 못한 예외를 200/4xx로 삼키지 않는다(silent failure 금지).
