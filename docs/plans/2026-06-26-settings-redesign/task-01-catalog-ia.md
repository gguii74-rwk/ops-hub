# Task 01 — 카탈로그 IA: group 필드 추가 + SMTP host 제거

**Purpose**: 카탈로그 엔트리에 표시 그룹 메타(`group`/`groupOrder`)를 추가하고, `integrations.smtp.host` systemSetting을 제거한다(env 전용, F4). `secure`/`user`는 추가하지 않는다. `calendarIds`는 손대지 않는다(PR-A는 systemSetting 유지).

## Files

- Modify `src/kernel/settings/registry.ts` — `SettingGroup` 타입 + `SettingEntryBase`에 `group`/`groupOrder`.
- Modify `src/kernel/settings/catalog.ts` — 전 엔트리에 group/groupOrder, `integrations.smtp.host` 제거.
- Modify `src/kernel/settings/service.ts` — `SettingsCatalogItem`에 `group`/`groupOrder` + `base`에 전파.
- Modify `tests/kernel/settings/catalog.test.ts` — 카운트(7 sys, total 13), host→port, group 검증.
- Modify `tests/kernel/settings/service.test.ts` — host 참조를 port/fromAddress로 교체.

## Prep

- spec §5.1, 엔트리포인트 §Shared Contracts SC-4(그룹 배정 표).
- Deps: 없음.

## TDD steps

### Step 1 — 카탈로그 테스트를 새 계약으로 갱신(FAIL 유도)

`tests/kernel/settings/catalog.test.ts`의 다음 블록을 교체/추가한다.

**(a) getEntry host 참조 교체** (line 57-60 부근):
```ts
  it("getEntry는 등록 key를 찾고 미등록은 undefined", () => {
    expect(getEntry("integrations.smtp.fromAddress")?.kind).toBe("systemSetting");
    expect(getEntry("nope.nope.nope")).toBeUndefined();
  });
```

**(b) 카운트 갱신** (line 62-68 부근):
```ts
  it("카탈로그 항목 수 고정 (6 systemSetting, 5 envSecret, 1 relational)", () => {
    const byKind = (k: string) => CATALOG.filter((e) => e.kind === k).length;
    expect(byKind("systemSetting")).toBe(6); // host·port 제거 후(fromAddress·calendarIds·defaultRecipients·onRequest·onApprove·onReject)
    expect(byKind("envSecret")).toBe(5);
    expect(byKind("relational")).toBe(1);
    expect(CATALOG.length).toBe(12);
  });
```

**(c) SMTP host 제거 + secure/user 미추가 + group 검증 추가** (describe 블록 안에 append):
```ts
  it("SMTP host·port systemSetting은 제거됨(env 전용 — host=F4, port=P3/A2), secure/user 미추가", () => {
    expect(getEntry("integrations.smtp.host")).toBeUndefined();
    expect(getEntry("integrations.smtp.port")).toBeUndefined();
    expect(getEntry("integrations.smtp.secure")).toBeUndefined();
    expect(getEntry("integrations.smtp.user")).toBeUndefined();
    // DB 편집 가능한 SMTP 필드는 fromAddress 하나뿐
    expect(getEntry("integrations.smtp.fromAddress")?.kind).toBe("systemSetting");
  });

  it("calendarIds는 systemSetting 유지(PR-A relational 전환 안 함)", () => {
    const e = getEntry("integrations.google.calendarIds");
    expect(e?.kind).toBe("systemSetting");
  });

  it("모든 엔트리에 group(6종)·groupOrder(number) 존재", () => {
    const groups = ["security", "mail", "google", "documents", "leave", "workflows"];
    for (const e of CATALOG) {
      expect(groups, `${e.key} group`).toContain(e.group);
      expect(typeof e.groupOrder, `${e.key} groupOrder`).toBe("number");
    }
  });

  it("그룹별 groupOrder는 유일(같은 group 내 중복 없음)", () => {
    const byGroup = new Map<string, number[]>();
    for (const e of CATALOG) {
      const arr = byGroup.get(e.group) ?? [];
      arr.push(e.groupOrder);
      byGroup.set(e.group, arr);
    }
    for (const [g, orders] of byGroup) {
      expect(new Set(orders).size, `${g} groupOrder unique`).toBe(orders.length);
    }
  });
```

실행: `npm test -- tests/kernel/settings/catalog.test.ts` → **FAIL**(group 속성 부재, host 아직 존재).

### Step 2 — registry.ts에 `SettingGroup` + group/groupOrder 추가

`src/kernel/settings/registry.ts`:

(a) `SettingCategory` 선언 아래에 추가:
```ts
export type SettingGroup = "security" | "mail" | "google" | "documents" | "leave" | "workflows";
```

(b) `SettingEntryBase`에 두 필드 추가:
```ts
interface SettingEntryBase {
  key: string;
  category: SettingCategory;
  group: SettingGroup;
  groupOrder: number;
  order: number;
  title: string;
  description: string;
  permission: { resource: string; action: Action };
}
```

### Step 3 — catalog.ts: host 제거 + 전 엔트리 group/groupOrder

`src/kernel/settings/catalog.ts`를 아래 전체 내용으로 교체한다(`integrations.smtp.host` 엔트리 삭제, 나머지 13개에 group/groupOrder 부여):

```ts
import "server-only";
import { z } from "zod";
import type { SettingEntry } from "./registry";

export const CATALOG: readonly SettingEntry[] = [
  // --- security (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.database",
    category: "security",
    group: "security",
    groupOrder: 1,
    order: 10,
    title: "데이터베이스 연결",
    description: "PostgreSQL 연결 문자열(런타임 secret).",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "DATABASE_URL", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.auth",
    category: "security",
    group: "security",
    groupOrder: 2,
    order: 11,
    title: "인증 secret",
    description: "NextAuth 세션 서명 secret(NEXTAUTH_SECRET 또는 AUTH_SECRET).",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "NEXTAUTH_SECRET", kind: "value", aliases: ["AUTH_SECRET"] }],
  },
  // --- integrations (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.google",
    category: "integrations",
    group: "google",
    groupOrder: 1,
    order: 20,
    title: "Google 서비스 계정",
    description: "Google API 서비스 계정 키 파일.",
    permission: { resource: "integrations.google", action: "view" },
    envVars: [{ name: "GOOGLE_APPLICATION_CREDENTIALS", kind: "filePath" }],
  },
  {
    kind: "envSecret",
    key: "secret.smtp",
    category: "integrations",
    group: "mail",
    groupOrder: 1,
    order: 21,
    title: "SMTP 비밀번호",
    description: "메일 발송 SMTP 계정 비밀번호.",
    permission: { resource: "integrations.smtp", action: "view" },
    envVars: [{ name: "SMTP_PASSWORD", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.libreoffice",
    category: "integrations",
    group: "documents",
    groupOrder: 1,
    order: 22,
    title: "LibreOffice 경로",
    description: "PDF 변환용 LibreOffice 실행 파일 경로.",
    permission: { resource: "integrations.templates", action: "view" },
    envVars: [{ name: "LIBREOFFICE_PATH", kind: "filePath" }],
  },
  // --- integrations (systemSetting) ---
  // NOTE: integrations.smtp.host·port 는 제거됨(env 전용 — host=F4, port=P3/A2). host/user/secure/port/password는 env 신뢰경계 유지.
  //        DB 편집 가능한 SMTP 필드 = fromAddress 하나뿐.
  {
    kind: "systemSetting",
    key: "integrations.smtp.fromAddress",
    category: "integrations",
    group: "mail",
    groupOrder: 2,
    order: 32,
    title: "발신 주소",
    description: "메일 기본 발신 이메일 주소.",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.string().email().or(z.literal("")), // 빈 문자열="미설정" 허용, 그 외엔 이메일 형식
    default: "",
    audit: "summary",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.google.calendarIds",
    category: "integrations",
    group: "google",
    groupOrder: 2,
    order: 33,
    title: "Google 캘린더 목록",
    description: "동기화 대상 Google 캘린더 ID 목록.",
    permission: { resource: "integrations.google", action: "configure" },
    schema: z.array(z.string().min(1)),
    default: [],
    audit: "summary",
    fallbackSafe: false,
  },
  // --- workflows (systemSetting) ---
  {
    kind: "systemSetting",
    key: "workflows.weeklyReport.defaultRecipients",
    category: "workflows",
    group: "workflows",
    groupOrder: 1,
    order: 40,
    title: "주간보고 기본 수신자",
    description: "주간보고 메일 기본 수신자 이메일 목록.",
    permission: { resource: "workflows.weekly", action: "configure" },
    schema: z.array(z.string().email()),
    default: [],
    audit: "summary",
    fallbackSafe: true,
  },
  // --- workflows (relational, 편집기 Phase 4) ---
  {
    kind: "relational",
    key: "workflows.billing.config",
    category: "workflows",
    group: "workflows",
    groupOrder: 2,
    order: 41,
    title: "대금청구 설정",
    description: "연도별 계약·청구 설정(전용 화면에서 관리, Phase 4).",
    permission: { resource: "workflows.billing", action: "configure" },
    model: "BillingConfig",
    manageHref: "/admin/settings/billing",
  },
  // --- leave (systemSetting) ---
  {
    kind: "systemSetting",
    key: "leave.notifications.onRequest",
    category: "leave",
    group: "leave",
    groupOrder: 1,
    order: 50,
    title: "연차 신청 알림 메일",
    description: "직원이 연차를 신청하면 승인 권한자에게 알림 메일을 보냅니다.",
    permission: { resource: "leave.admin", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "full",
    fallbackSafe: true,
  },
  {
    kind: "systemSetting",
    key: "leave.notifications.onApprove",
    category: "leave",
    group: "leave",
    groupOrder: 2,
    order: 51,
    title: "연차 승인 알림 메일",
    description: "연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다.",
    permission: { resource: "leave.admin", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "full",
    fallbackSafe: true,
  },
  {
    kind: "systemSetting",
    key: "leave.notifications.onReject",
    category: "leave",
    group: "leave",
    groupOrder: 3,
    order: 52,
    title: "연차 반려 알림 메일",
    description: "연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다.",
    permission: { resource: "leave.admin", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "full",
    fallbackSafe: true,
  },
];

export const SYSTEM_KEYS: ReadonlySet<string> = new Set(
  CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key),
);

export function getEntry(key: string): SettingEntry | undefined {
  return CATALOG.find((e) => e.key === key);
}
```

### Step 4 — service.ts: SettingsCatalogItem + base에 group/groupOrder

`src/kernel/settings/service.ts`:

(a) import에 `SettingGroup` 추가:
```ts
import type {
  AuditMode,
  EnvSecretEntry,
  SettingCategory,
  SettingEntry,
  SettingGroup,
  SettingStatus,
} from "./registry";
```

(b) `SettingsCatalogItem`에 두 필드 추가(`category` 아래):
```ts
export interface SettingsCatalogItem {
  key: string;
  kind: SettingEntry["kind"];
  category: SettingCategory;
  group: SettingGroup;
  groupOrder: number;
  order: number;
  title: string;
  description: string;
  status: SettingStatus;
  manageHref?: string;
  value?: unknown;
  updatedAt?: Date;
}
```

(c) `listSettings`의 `base` 객체에 전파:
```ts
    const base = {
      key: e.key,
      kind: e.kind,
      category: e.category,
      group: e.group,
      groupOrder: e.groupOrder,
      order: e.order,
      title: e.title,
      description: e.description,
    };
```

실행: `npm test -- tests/kernel/settings/catalog.test.ts` → **PASS**.

### Step 5 — service.test.ts: host 참조를 port/fromAddress로 교체(FAIL→PASS)

`tests/kernel/settings/service.test.ts`에서 제거된 `integrations.smtp.host`를 참조하는 케이스를 교체한다. (host는 더 이상 카탈로그에 없어 `getSetting`/`setSetting`이 `UnknownSettingError`를 던진다.)

**(a) "유효 row → 값"** (line 79-82):
```ts
  it("유효 row → 값", async () => {
    store.set("integrations.smtp.fromAddress", { value: "ops@x.com", updatedAt: new Date() });
    expect(await getSetting("integrations.smtp.fromAddress")).toBe("ops@x.com");
  });
```

**(b) "invalid row + fallbackSafe=false → SettingInvalidError"** (line 87-90):
```ts
  it("invalid row + fallbackSafe=false → SettingInvalidError", async () => {
    store.set("integrations.smtp.fromAddress", { value: 123, updatedAt: new Date() });
    await expect(getSetting("integrations.smtp.fromAddress")).rejects.toBeInstanceOf(SettingInvalidError);
  });
```

**(c) "actorId 누락"** (line 94-96): key를 fromAddress로:
```ts
  it("actorId 누락 → SettingActorRequiredError", async () => {
    await expect(setSetting("integrations.smtp.fromAddress", "x", { actorId: "", expectedUpdatedAt: null })).rejects.toBeInstanceOf(SettingActorRequiredError);
  });
```

**(d) listSettings "권한 있는 항목만 포함"** (line 143-149): host→fromAddress(port도 제거됨):
```ts
  it("권한 있는 항목만 포함(hasPermission 기준)", async () => {
    setAllowed(new Set(["integrations.smtp:configure"]));
    const items = await listSettings("u1");
    const keys = items.map((i) => i.key);
    expect(keys).toContain("integrations.smtp.fromAddress");
    expect(keys).not.toContain("workflows.weeklyReport.defaultRecipients");
  });
```

**(e) listSettings "systemSetting status invalid→INVALID"** (line 150-157): host→fromAddress(default ""):
```ts
  it("systemSetting status: 유효→OK(value), invalid→INVALID(default)", async () => {
    setAllowed(new Set(["integrations.smtp:configure"]));
    store.set("integrations.smtp.fromAddress", { value: 123, updatedAt: new Date() }); // invalid
    const items = await listSettings("u1");
    const from = items.find((i) => i.key === "integrations.smtp.fromAddress")!;
    expect(from.status).toBe("INVALID");
    expect(from.value).toBe(""); // default
  });
```

**(f) "row 없음 → default"** (line 76-78): port가 카탈로그에서 제거됐으므로 키를 fromAddress(default "")로:
```ts
  it("row 없음 → default", async () => {
    expect(await getSetting("integrations.smtp.fromAddress")).toBe("");
  });
```

**(g) setSetting "성공 → writeWithAudit"** (line 109-115): port(coerce) 대신 fromAddress(string)로:
```ts
  it("성공 → writeWithAudit 호출(검증된 값·actorId·expectedUpdatedAt·redact 전달)", async () => {
    const at = new Date(2026, 0, 1);
    await setSetting("integrations.smtp.fromAddress", "ops@x.com", { actorId: "u1", expectedUpdatedAt: at });
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({ key: "integrations.smtp.fromAddress", value: "ops@x.com", actorId: "u1", expectedUpdatedAt: at });
    expect(typeof writeCalls[0].redact).toBe("function");
  });
```

> `setSetting` "Zod 실패" 케이스(line 106-108)는 이미 `integrations.smtp.fromAddress`에 `"not-email"`을 넣어 SettingValidationError를 검증하므로 **그대로 둔다**. "envSecret status=coarse" secret.smtp·"relational status=LINK"도 그대로 두되, secret.smtp 행 상태(F12)는 task-05에서 갱신한다.

실행: `npm test -- tests/kernel/settings/service.test.ts` → **PASS**.

## Acceptance Criteria

```bash
npm test -- tests/kernel/settings/catalog.test.ts   # PASS
npm test -- tests/kernel/settings/service.test.ts    # PASS
npm run typecheck                                    # 0 errors (group/groupOrder 필수 필드 전파)
npm run lint                                         # 0 errors (boundaries 포함)
```

## Cautions

- **Don't `integrations.smtp.host`/`port`/`secure`/`user`를 카탈로그에 남기지 마라.** Reason: 전부 env 전용 — host=F4(전역 env 비밀번호 유출 벡터 차단), port=P3/A2(port/TLS 모드는 결합돼 있어 `secure`와 함께 env 한 곳에서 관리; DB 편집 시 드리프트). DB 편집 가능한 SMTP 필드 = `fromAddress`만.
- **Don't `category` 필드를 삭제하지 마라.** Reason: 기존 route/test가 category에 의존(보존 결정 D7). group은 **추가**일 뿐 category 대체가 아니다.
- **Don't `calendarIds`의 kind를 바꾸지 마라.** Reason: relational 전환은 PR-B(F10). PR-A는 systemSetting 유지 + 리스트 편집기(task-06)만.
- **Don't `order` 필드를 제거하지 마라.** Reason: `listSettings`가 여전히 `order`로 정렬(페이지가 group 버킷팅) — 제거하면 정렬 깨짐.
