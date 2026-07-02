# Task 09 — 설정 카탈로그 정리·진입(⑦·D9)

死설정 `workflows.weeklyReport.defaultRecipients`를 catalog·편집기 특례에서 제거하고, `workflows.billing.config`의 깨진 `manageHref`를 고치고, "메일 수신자" relational 항목을 추가한다.

## Files
- Modify: `src/kernel/settings/catalog.ts`
- Modify: `src/app/(app)/admin/settings/settings-editor.tsx` (email 특례 제거)
- Test: `tests/kernel/settings/catalog.test.ts` (개수·항목 단언 갱신)
- Test: `tests/kernel/settings/service.test.ts` (weeklyReport 키 참조 2곳 교체)
- Test: `tests/app/admin/settings-editor.test.tsx` (email 특례 케이스 제거)

## Prep
- 엔트리포인트 §SC-9.
- 참조: `src/kernel/settings/catalog.ts` 101~130행(제거·수정 대상), `tests/kernel/settings/catalog.test.ts` 62~68행(개수 고정 테스트).

## Deps
- Task 05(`workflows.mail:configure`가 seed 집합에 존재해야 `seed-permissions.test.ts`의 "카탈로그 permission ⊆ seed" 검사 통과).

## Cautions
- **Don't DB `kernel."SystemSetting"`의 잔존 행을 지우는 마이그레이션을 만들지 마라.** Reason: §4.6 — catalog 기반 노출이라 잔존 무해. 값 확인은 배포 preflight(수동 판단).
- **Don't `getSetting("workflows.weeklyReport.defaultRecipients")` 소비처를 찾아 고치려 하지 마라.** Reason: 소비처 0(死설정 — 확인 완료). catalog 제거만으로 충분.
- **Don't 새 항목의 permission을 `admin.settings:configure`로 두지 마라.** Reason: D9·D6 — 항목 권한은 `workflows.mail:configure`(카드 노출 게이트). 교집합의 나머지 절반(admin.settings)은 listSettings의 base 게이트가 이미 강제.
- **Don't ListSettingEditor의 "비어있지 않음+중복" 검증까지 제거하지 마라.** Reason: 특례(email 형식)만 제거 — 나머지는 calendarIds 등 다른 리스트 설정이 쓴다.

## TDD Steps

### 1. catalog 테스트 갱신 — 실패 먼저

`tests/kernel/settings/catalog.test.ts` 수정:

"카탈로그 항목 수 고정" 케이스(62~68행)를 교체:

```ts
  it("카탈로그 항목 수 고정 (5 systemSetting, 5 envSecret, 2 relational)", () => {
    const byKind = (k: string) => CATALOG.filter((e) => e.kind === k).length;
    expect(byKind("systemSetting")).toBe(5); // weeklyReport.defaultRecipients 제거 후(fromAddress·calendarIds·onRequest·onApprove·onReject)
    expect(byKind("envSecret")).toBe(5);
    expect(byKind("relational")).toBe(2); // billing.config + mail.recipients
    expect(CATALOG.length).toBe(12);
  });
```

파일 하단에 describe 케이스 추가:

```ts
  it("workflows.weeklyReport.defaultRecipients는 제거됨(死설정 정리 ⑦)", () => {
    expect(getEntry("workflows.weeklyReport.defaultRecipients")).toBeUndefined();
  });

  it("메일 수신자 relational 항목(D9) — workflows.mail:configure·전용 관리 페이지", () => {
    const e = getEntry("workflows.mail.recipients");
    expect(e?.kind).toBe("relational");
    expect(e?.category).toBe("workflows");
    expect(e?.group).toBe("workflows");
    expect(e?.permission).toEqual({ resource: "workflows.mail", action: "configure" });
    if (e?.kind !== "relational") throw new Error("unreachable");
    expect(e.manageHref).toBe("/admin/settings/mail-recipients");
  });

  it("대금청구 설정 manageHref = 실제 관리 페이지 경로(⑦ — 깨진 /admin/settings/billing 수정)", () => {
    const e = getEntry("workflows.billing.config");
    if (e?.kind !== "relational") throw new Error("unreachable");
    expect(e.manageHref).toBe("/workflows/billing/settings");
  });
```

실행: `npm test -- tests/kernel/settings/catalog.test.ts` → **FAIL**.

### 2. catalog.ts 구현

`src/kernel/settings/catalog.ts`에서 `--- workflows (systemSetting) ---` 주석과 `workflows.weeklyReport.defaultRecipients` 항목(102~116행)을 **삭제**하고, workflows 블록을 다음으로 교체:

```ts
  // --- workflows ---
  {
    kind: "relational",
    key: "workflows.mail.recipients",
    category: "workflows",
    group: "workflows",
    groupOrder: 1,
    order: 40,
    title: "메일 수신자",
    description: "주소록과 업무유형×발송단계별 기본 수신자 세트를 관리합니다.",
    permission: { resource: "workflows.mail", action: "configure" },
    model: "MailContact",
    manageHref: "/admin/settings/mail-recipients",
  },
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
    manageHref: "/workflows/billing/settings",
  },
```

실행: `npm test -- tests/kernel/settings/catalog.test.ts` → **PASS**.

### 3. 편집기 특례 제거 + 관련 테스트 정리

`src/app/(app)/admin/settings/settings-editor.tsx`:
- 211행 `const EMAIL_RE = …` 삭제.
- `ListSettingEditor`의 특례 주석·`requireEmail` 선언(222~223행)과 `addItem` 내 email 분기(232~235행) 삭제 — 남는 검증은 "비어있지 않음 + 중복"뿐. 주석은 다음으로 교체:

```ts
  // 리스트 항목은 비어있지 않음+중복만 클라 검증. 서버 zod가 권위.
```

`tests/app/admin/settings-editor.test.tsx`: `"list 편집기(이메일 키): 잘못된 형식 추가 거부"` 케이스(147~155행) **삭제**(대상 키·특례가 카탈로그에서 제거됨 — email 리스트 설정은 더 이상 없다).

`tests/kernel/settings/service.test.ts`:
- 83~86행 fallbackSafe 케이스를 남은 fallbackSafe=true 키(leave boolean)로 교체:

```ts
  it("invalid row + fallbackSafe=true → default(no throw)", async () => {
    store.set("leave.notifications.onRequest", { value: "not-a-boolean", updatedAt: new Date() });
    expect(await getSetting("leave.notifications.onRequest")).toBe(true);
  });
```

- 148행 `expect(keys).not.toContain("workflows.weeklyReport.defaultRecipients");` → 권한 없는 항목 부재 단언 유지 목적이므로 교체:

```ts
    expect(keys).not.toContain("workflows.mail.recipients"); // workflows.mail:configure 미보유 → 항목 숨김
```

- 177~182행 "relational status=LINK + manageHref" 케이스의 기대값 교체(⑦ href 수정 반영):

```ts
    expect(billing.manageHref).toBe("/workflows/billing/settings");
```

실행: `npm test -- tests/kernel/settings tests/app/admin/settings-editor.test.tsx` → **PASS**.

### 4. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/kernel/settings tests/app/admin/settings-editor.test.tsx
```

`tests/kernel/settings/seed-permissions.test.ts`가 이 스위트에 포함된다 — task-05의 `["workflows.mail","configure"]` seed 추가 덕에 "카탈로그 permission ⊆ seed 집합"이 통과해야 한다(실패하면 task-05 미완). 전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과.
- `npm test -- tests/kernel/settings tests/app/admin/settings-editor.test.tsx` → 통과.
- `getEntry("workflows.weeklyReport.defaultRecipients")` → undefined. `EMAIL_RE`/`requireEmail` 코드 잔존 0(`grep -rn "requireEmail\|EMAIL_RE" src` 0건).
- 설정 페이지(수동 확인은 배포 후): workflows 그룹 카드에 "메일 수신자"(권한자) + "대금청구 설정" 링크가 `/workflows/billing/settings`.
