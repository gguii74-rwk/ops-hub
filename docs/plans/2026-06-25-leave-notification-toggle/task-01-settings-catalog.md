# task-01 — 설정 카탈로그: leave 카테고리 + 3키 + 화면 노출

연차 알림 토글 3키를 설정 카탈로그에 신규 카테고리 `"leave"`로 등록하고, 설정 화면(`/admin/settings`)이 해당 카테고리 Card를 렌더하도록 라벨·순서를 추가한다.

## Files

- Modify: `src/kernel/settings/catalog.ts` — `CATALOG`에 leave 3키 추가(권한 `leave.admin:configure`, audit `full`).
- Modify: `src/kernel/settings/registry.ts` — `SettingCategory` union에 `"leave"`.
- Modify: `src/app/(app)/admin/settings/page.tsx` — `CATEGORY_LABELS`·`CATEGORY_ORDER`에 leave.
- Modify: `prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS`에 `["leave.admin", "configure"]` 추가(D6 신규 권한).
- Test: `tests/kernel/settings/catalog.test.ts` — 카테고리 화이트리스트·항목 수 갱신 + 3키 검증(권한·audit 포함) 추가.
- Test: `tests/kernel/access/leave-permissions.test.ts` — `EXTRA_PERMISSIONS`에 `["leave.admin","configure"]` 포함 가드.

## Prep

- 읽기: 엔트리포인트 §SC-1(키·필드·권한 D6), spec §1·§2·결정 D6.
- 기존 `catalog.ts`의 도메인 `systemSetting` 패턴 — 권한은 **도메인 스코프 configure**(SMTP→`integrations.smtp:configure`, weekly→`workflows.weekly:configure`). leave 토글은 `leave.admin:configure`(D6).
- 기존 `catalog.test.ts`는 카테고리 화이트리스트(L11)·항목 수(L64–67)를 하드코딩 → impl과 같은 변경에서 갱신.
- `leave.admin` 리소스는 이미 `RESOURCES`에 존재(`leave.admin:view` 사용 중). `configure` 액션만 `EXTRA_PERMISSIONS`에 추가하면 pm(`"*"`)·OWNER가 자동 보유, 위임 user-admin은 미보유.

## Deps

없음.

## TDD steps

### Step 1 — 테스트 갱신(실패 확인)

`tests/kernel/settings/catalog.test.ts`를 아래 3곳 수정한다.

(1) 카테고리 화이트리스트(L11)에 `"leave"` 추가:

```ts
      expect(["security", "integrations", "workflows", "leave", "general"]).toContain(e.category);
```

(2) 항목 수 단언(현재 "5 systemSetting, 5 envSecret, 1 relational" 블록)을 8/5/1/14로 갱신:

```ts
  it("카탈로그 항목 수 고정 (8 systemSetting, 5 envSecret, 1 relational)", () => {
    const byKind = (k: string) => CATALOG.filter((e) => e.kind === k).length;
    expect(byKind("systemSetting")).toBe(8);
    expect(byKind("envSecret")).toBe(5);
    expect(byKind("relational")).toBe(1);
    expect(CATALOG.length).toBe(14);
  });
```

(3) describe 블록 끝에 leave 3키 검증을 추가:

```ts
  it("leave 알림 3키 — category=leave·default true·z.boolean·leave.admin:configure·audit full", () => {
    const keys = [
      "leave.notifications.onRequest",
      "leave.notifications.onApprove",
      "leave.notifications.onReject",
    ];
    for (const key of keys) {
      const e = getEntry(key);
      expect(e, `${key} 존재`).toBeDefined();
      expect(e!.kind).toBe("systemSetting");
      expect(e!.category).toBe("leave");
      expect(e!.permission).toEqual({ resource: "leave.admin", action: "configure" }); // D6 도메인 스코프
      if (e!.kind !== "systemSetting") throw new Error("unreachable");
      expect(e!.default).toBe(true);
      expect(e!.audit).toBe("full"); // E: OFF/ON 방향 감사 기록
      expect(e!.fallbackSafe).toBe(true);
      // z.boolean(): true/false 통과, 비boolean reject
      expect(e!.schema.safeParse(true).success).toBe(true);
      expect(e!.schema.safeParse(false).success).toBe(true);
      expect(e!.schema.safeParse("true").success).toBe(false);
      expect(e!.schema.safeParse(1).success).toBe(false);
    }
  });
```

(4) `tests/kernel/access/leave-permissions.test.ts`에 `leave.admin:configure` 시드 가드 추가. "EXTRA_PERMISSIONS에 leave 관리 키" it 블록 끝에 한 줄:

```ts
    expect(hasExtra("leave.admin", "configure")).toBe(true); // D6 — 알림 토글 쓰기 권한
```

그리고 "작업자 role에 관리자 전용 키 없음" it의 `adminKeys` 배열에 추가(작업자 미보유 가드):

```ts
    const adminKeys = ["leave.approval:approve", "leave.allocation:configure", "leave.request:update", "leave.request:delete", "leave.admin:configure"];
```

실행(FAIL 기대 — 키 미존재 + 항목 수 5/11 + leave.admin:configure 미시드):

```bash
npx vitest run tests/kernel/settings/catalog.test.ts tests/kernel/access/leave-permissions.test.ts
```

### Step 2 — catalog.ts에 3키 추가

`src/kernel/settings/catalog.ts`에서 workflows `relational` 항목(`workflows.billing.config`) **다음**, 닫는 `];` **앞**에 아래 블록을 추가한다:

```ts
  // --- leave (systemSetting) ---
  {
    kind: "systemSetting",
    key: "leave.notifications.onRequest",
    category: "leave",
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
    order: 52,
    title: "연차 반려 알림 메일",
    description: "연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다.",
    permission: { resource: "leave.admin", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "full",
    fallbackSafe: true,
  },
```

### Step 3 — registry.ts SettingCategory에 leave

`src/kernel/settings/registry.ts`의 `SettingCategory` 타입을 수정:

```ts
export type SettingCategory = "security" | "integrations" | "workflows" | "leave" | "general";
```

### Step 4 — page.tsx 라벨·순서

`src/app/(app)/admin/settings/page.tsx`에서:

`CATEGORY_LABELS`에 `leave` 추가:

```ts
const CATEGORY_LABELS: Record<string, string> = {
  security: "보안",
  integrations: "연동",
  workflows: "업무",
  leave: "연차",
  general: "일반",
};
```

`CATEGORY_ORDER`를 workflows 다음에 leave 삽입:

```ts
const CATEGORY_ORDER = ["security", "integrations", "workflows", "leave", "general"] as const;
```

### Step 5 — seed-permissions.ts에 leave.admin:configure 추가 (D6)

`prisma/seed-permissions.ts`의 `EXTRA_PERMISSIONS` 배열에 한 항목 추가(기존 leave 항목 인근):

```ts
  ["leave.allocation", "view"],
  ["leave.allocation", "configure"],
  ["leave.admin", "configure"],
```

> pm은 `ROLE_ALLOW.pm = ["*"]`로 자동 보유, OWNER는 systemRole로 자동 허용. 위임 `admin` 역할은 이 키를 나열하지 않으므로 미보유(의도된 경계). seed-roles 수정 불필요.

실행(PASS 기대):

```bash
npx vitest run tests/kernel/settings/catalog.test.ts tests/kernel/access/leave-permissions.test.ts
```

### Step 6 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

전부 통과하면 커밋(변경 파일만 명시 stage):

```bash
git add src/kernel/settings/catalog.ts src/kernel/settings/registry.ts "src/app/(app)/admin/settings/page.tsx" prisma/seed-permissions.ts tests/kernel/settings/catalog.test.ts tests/kernel/access/leave-permissions.test.ts
git commit -m "feat(settings): 연차 알림 토글 3키 + leave 설정 카테고리 + leave.admin:configure 권한"
```

## Acceptance Criteria

- `npx vitest run tests/kernel/settings/catalog.test.ts` — leave 3키(권한 `leave.admin:configure`·audit `full`)·항목 수(8/5/1/14)·카테고리 통과.
- `npx vitest run tests/kernel/access/leave-permissions.test.ts` — `leave.admin:configure` 시드 포함 + 작업자 role 미보유 통과.
- `npm run typecheck` — `SettingCategory`에 leave 추가로 타입 에러 없음.
- `npm run lint` — 통과.
- `npm test` — 전체 그린(다른 설정/페이지/권한 테스트 회귀 없음).

## Cautions

- **`SettingCategory`에 leave를 먼저 추가하지 않으면** `catalog.ts`의 `category: "leave"`가 타입 에러. registry → catalog 순서 무관하나 둘 다 같은 커밋에 포함해야 typecheck 통과.
- **항목 수 단언을 갱신하지 마라**는 금지가 아니다 — 갱신이 **필수**다. 3키 추가로 systemSetting 5→8, 전체 11→14. 누락하면 그 테스트가 적색.
- `CATEGORY_ORDER`에서 leave를 general **앞**(workflows 다음)에 둔다. general을 마지막에 유지(기존 관례).
- catalog 항목의 `order`는 50/51/52 — workflows(40번대) 다음, 카테고리 내 정렬용. 다른 카테고리 order와 겹쳐도 무해(`listSettings`가 전역 order로 정렬하나 카테고리별 Card로 분리 렌더).
- **권한은 `leave.admin:configure`(도메인 스코프, D6) — generic `admin.settings:configure`가 아니다.** 기존 도메인 설정(SMTP·weekly)과 동일 패턴. 이렇게 해야 leave 권한 없는 위임 user-admin이 연차 메일을 못 끈다. `EXTRA_PERMISSIONS` 추가를 빠뜨리면 `leave.admin:configure`가 미시드돼 OWNER만 토글 가능(pm "*"도 미시드 키는 못 받음).
- **`audit: "full"`(E) — `"summary"` 아님.** boolean은 비민감이라 full로 before/after를 남겨 OFF/ON 방향을 감사에서 식별. summary는 `true→false`/`false→true`를 구분 못 한다.
- **배포 시 `npm run db:seed` 필요** — `leave.admin:configure` 권한 등록(task-04의 nav 등록과 함께).
