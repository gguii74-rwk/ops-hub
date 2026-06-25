# task-01 — 설정 카탈로그: leave 카테고리 + 3키 + 화면 노출

연차 알림 토글 3키를 설정 카탈로그에 신규 카테고리 `"leave"`로 등록하고, 설정 화면(`/admin/settings`)이 해당 카테고리 Card를 렌더하도록 라벨·순서를 추가한다.

## Files

- Modify: `src/kernel/settings/catalog.ts` — `CATALOG`에 leave 3키 추가.
- Modify: `src/kernel/settings/registry.ts` — `SettingCategory` union에 `"leave"`.
- Modify: `src/app/(app)/admin/settings/page.tsx` — `CATEGORY_LABELS`·`CATEGORY_ORDER`에 leave.
- Test: `tests/kernel/settings/catalog.test.ts` — 카테고리 화이트리스트·항목 수 갱신 + 3키 검증 추가.

## Prep

- 읽기: 엔트리포인트 §SC-1(키·필드 표), spec §1·§2.
- 기존 `catalog.ts`의 SMTP `systemSetting` 패턴(host/port/fromAddress)을 그대로 따른다.
- 기존 `catalog.test.ts`는 카테고리 화이트리스트(L11)·항목 수(L64–67)를 하드코딩 → impl과 같은 변경에서 갱신.

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
  it("leave 알림 3키 — category=leave·default true·z.boolean·configure 권한", () => {
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
      expect(e!.permission).toEqual({ resource: "admin.settings", action: "configure" });
      if (e!.kind !== "systemSetting") throw new Error("unreachable");
      expect(e!.default).toBe(true);
      expect(e!.audit).toBe("summary");
      expect(e!.fallbackSafe).toBe(true);
      // z.boolean(): true/false 통과, 비boolean reject
      expect(e!.schema.safeParse(true).success).toBe(true);
      expect(e!.schema.safeParse(false).success).toBe(true);
      expect(e!.schema.safeParse("true").success).toBe(false);
      expect(e!.schema.safeParse(1).success).toBe(false);
    }
  });
```

실행(FAIL 기대 — 키 미존재 + 항목 수 5/11):

```bash
npx vitest run tests/kernel/settings/catalog.test.ts
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
    permission: { resource: "admin.settings", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "summary",
    fallbackSafe: true,
  },
  {
    kind: "systemSetting",
    key: "leave.notifications.onApprove",
    category: "leave",
    order: 51,
    title: "연차 승인 알림 메일",
    description: "연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다.",
    permission: { resource: "admin.settings", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "summary",
    fallbackSafe: true,
  },
  {
    kind: "systemSetting",
    key: "leave.notifications.onReject",
    category: "leave",
    order: 52,
    title: "연차 반려 알림 메일",
    description: "연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다.",
    permission: { resource: "admin.settings", action: "configure" },
    schema: z.boolean(),
    default: true,
    audit: "summary",
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

실행(PASS 기대):

```bash
npx vitest run tests/kernel/settings/catalog.test.ts
```

### Step 5 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

전부 통과하면 커밋(변경 파일만 명시 stage):

```bash
git add src/kernel/settings/catalog.ts src/kernel/settings/registry.ts "src/app/(app)/admin/settings/page.tsx" tests/kernel/settings/catalog.test.ts
git commit -m "feat(settings): 연차 알림 토글 3키 + leave 설정 카테고리"
```

## Acceptance Criteria

- `npx vitest run tests/kernel/settings/catalog.test.ts` — leave 3키·항목 수(8/5/1/14)·카테고리 통과.
- `npm run typecheck` — `SettingCategory`에 leave 추가로 타입 에러 없음.
- `npm run lint` — 통과.
- `npm test` — 전체 그린(다른 설정/페이지 테스트 회귀 없음).

## Cautions

- **`SettingCategory`에 leave를 먼저 추가하지 않으면** `catalog.ts`의 `category: "leave"`가 타입 에러. registry → catalog 순서 무관하나 둘 다 같은 커밋에 포함해야 typecheck 통과.
- **항목 수 단언을 갱신하지 마라**는 금지가 아니다 — 갱신이 **필수**다. 3키 추가로 systemSetting 5→8, 전체 11→14. 누락하면 그 테스트가 적색.
- `CATEGORY_ORDER`에서 leave를 general **앞**(workflows 다음)에 둔다. general을 마지막에 유지(기존 관례).
- catalog 항목의 `order`는 50/51/52 — workflows(40번대) 다음, 카테고리 내 정렬용. 다른 카테고리 order와 겹쳐도 무해(`listSettings`가 전역 order로 정렬하나 카테고리별 Card로 분리 렌더).
