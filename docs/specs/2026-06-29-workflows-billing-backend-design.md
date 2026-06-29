# 대금청구(Billing) 백엔드 마이그레이션 설계

- Status: Draft (brainstorming 합의 반영 — 범위·저장소·검증 3결정 + 추천안 ①A/②수술적/③일반화 승인)
- Date: 2026-06-29
- Roadmap: `docs/product/modernization-roadmap.md` Phase 4 (Workflows 포팅) — sub-project 3(대금청구)
- 선행: Phase 4 **공통 기반**(`docs/specs/2026-06-19-phase-4-workflows-core-design.md`) 머지 완료 — 전이 엔진·메일 인프라·`GeneratorPort` 계약·`MailDelivery` 이력이 이미 존재한다.
- 마이그레이션 레퍼런스: `D:\workspace\day-sync\docs\migration` — 특히 [04-feature-billing](../../../day-sync/docs/migration/04-feature-billing.md), [STRATEGY](../../../day-sync/docs/migration/STRATEGY.md)(하이브리드 3층 검증), [06-integrations](../../../day-sync/docs/migration/06-integrations.md)(HWPX 함정).

## 1. 목표와 범위

day-sync 대금청구(월 1회 기성 대금 청구: 계약설정 CRUD → HWPX 4종 생성 → 3단계 메일 발송)를 ops-hub `modules/workflows`로 포팅한다. 상태머신·메일 발송 엔진·`GeneratorPort` 계약은 공통 기반에 이미 있으므로, **남은 본체는 HWPX 4종 생성기 + 설정 CRUD + 파일 저장소 계층 + generate/send/다운로드 라우트**다.

대금청구는 세 워크플로 중 **외부 어댑터 의존이 가장 적다** — Google Sheets·Anthropic·LibreOffice PDF가 전부 불필요하고(`BillingConfig`(DB) + Template HWPX만 사용), JSZip·exceljs는 이미 설치돼 있다. 새로 도입하는 외부 의존은 **파일시스템 저장소 계층뿐**이다. 따라서 가장 자기완결적인 첫 슬라이스다.

### 포함 (이 스펙 = 백엔드 우선)

- ① `WorkflowType(BILLING)` 시드 + 권한/역할 grant
- ② 파일 저장소 계층 `src/lib/storage/` (템플릿 읽기·산출물 쓰기·경로 저장/해석·traversal 가드)
- ③ 설정 CRUD 백엔드: `BillingConfig`/`BillingRoundDate` validations·repositories·service·API
- ④ HWPX 4종 생성기 (`GeneratorPort` 구현체 + generator 레지스트리)
- ⑤ generate/send 오케스트레이션 + 단계별 첨부 규칙(**1·2단계만**, 3단계는 F2로 이전) + 일반(kind 디스패치) 라우트
- ⑥ 다운로드 API (`GeneratedFile.id` 기준, 디렉터리 ZIP)
- ⑦ 검증: 하이브리드 3층(단위 + 골든 + 수동 한컴 게이트) + Phase 0 골든 캡처

### 비포함 (후속 sub-project)

- **설정 UI 화면**(`/workflows/billing/settings` 등) — 후속 spec. 설정 데이터는 시드/스크립트로 주입해 생성·발송을 E2E 검증한다(D1).
- **단계별 메일 제목/본문 템플릿** — 발송 라우트는 `subject`/`body`를 caller 파라미터로 받는다(D7). 기본 템플릿·골든 대조는 텍스트 출처가 확정되는 UI 단계에서.
- **3단계(FINAL_SENT) 최종 발송 + 업로드 첨부**(F2) — 업로드 artifact backend 계약(저장·검증·id 기반 첨부 선택)이 필요하고 UI 주도이므로 후속 UI spec으로 이전. 이 슬라이스는 1·2단계만. (전이 정책 `HQ_REQUESTED→FINAL_SENT`는 유지.)
- 주간보고·알림톡 생성기 — 단, generate/send/다운로드 라우트와 generator 레지스트리는 **kind 디스패치로 일반화**해 후속이 등록만으로 재사용(D6).

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | **백엔드 우선, UI 분리.** 설정값은 시드/스크립트로 주입해 생성·발송 E2E 검증 | 위험한 본체(HWPX 생성·발송)에 집중. UI는 동작하는 백엔드 위에 자연스럽게 올라감([00-overview §5] "프론트 마지막") |
| D2 | **파일 저장소 = `STORAGE_ROOT` env 1개 + `lib/storage` 헬퍼.** DB엔 storage-relative POSIX 경로만 저장. resolver는 **전부 strict**(절대경로·`..`·드라이브 거부; 다운로드·generate·메일 첨부 모두, F4·I4). 절대경로 유입 row는 런타임 통과 없이 마이그레이션으로 정규화 | 공유 스토리지를 릴리즈와 분리(CLAUDE.md). 절대경로 누출·경로 주입·메일 exfiltration 차단 |
| D3 | **출력 레이아웃 = `out/workflows/<taskId>/`** (taskId 기반). day-sync `billing-{YYYYMM}/` 폐기 | taskId가 유일 키 — 같은 달 재생성·다중 작업 충돌 방지. 다운로드가 task로 귀속 |
| D4 | **스키마 변경 없음**(모델 선반영) → 표준 restart. `WorkflowType(BILLING)` 시드 + 권한/역할은 `seed-permissions.ts` `EXTRA_PERMISSIONS` | 비파괴 — full-stop 마이그레이션 불필요. foundation §13 후속 이행 |
| D5 | **BigInt 경계**: DB는 BigInt 유지, 생성기 입력·API DTO는 `Number()`. **Zod refine으로 `<= Number.MAX_SAFE_INTEGER` 강제**(F3)해 Number() 경계를 검증으로 보장 | Prisma가 bigint 반환·`JSON.stringify`가 bigint 거부. 가정이 아닌 강제 — 큰 금액 조용한 변조 차단 |
| D6 | **generate/send/download 라우트 일반화**(kind 디스패치) + `Record<WorkflowKind, GeneratorPort>` 레지스트리. billing만 등록, 미등록 kind는 명확한 에러 | 후속 sub-project가 라우트 3벌 복제 없이 재사용. 마이그레이션 문서의 port+레지스트리 패턴 |
| D7 | **메일 제목/본문은 caller 제공**(A안). 단계별 기본 템플릿·발송 골든 대조는 후속 UI spec | day-sync `send.service`도 subject/body를 인자로 받음 — 텍스트 출처는 UI. 백엔드는 첨부 규칙·전이만 책임 |
| D8 | **`mail.ts` 수술적 적응**: `deliver`는 `toStoredOutputPath`로 상대 저장(out 밖이면 거부), `retryDelivery`는 **`resolveStoragePath`(strict)** 로 절대화·절대경로 row 거부(I4) | attachmentPaths 상대경로 일원화(D2)와 기존 `existsSync`/`sendMail` 조화. leave 회귀 테스트로 보호. 메일 exfiltration 차단 |
| D9 | **HWPX 치환에 사용자 입력 XML 이스케이프 추가**(`& < > " '`). split/join 치환·분리 run 마커·"02월 기준" 마커·전월 회차 계산 보존 | day-sync는 신뢰 설정값이라 미적용했으나 ops-hub는 입력 신뢰도가 낮음. 누락 시 한컴 무성 실패 |
| D10 | **회차 영속은 최종 commit tx 안에서 `createRoundDateIfMissing`**(I3 — 성공 경로에서만, 기존 행 덮어쓰기 금지). FS 생성·승격은 tx 밖, 그 뒤 짧은 CAS tx로 GENERATED+파일+회차 기록 | 누락 시 과거 회차 날짜 폴백(§8)이나, 실패한 generation이 수동 보정 회차일을 오염시키면 안 됨(I3). FS I/O 동안 DB tx 미점유(I2) |
| D11 | **send/cancel 상호배제(양측·삼중)**: ①send 선-SMTP — SENDING 선기록을 status 가드와 한 tx로 점유. ②send 후-SMTP(G2b) — finalize(SENT)+transition 한 tx, 그때까지 SENDING 유지. ③cancel 측(H1) — `GENERATED ∧ ¬active-SENDING` 단일 조건부 UPDATE로 원자화. `(taskId,step)` partial unique(마이그 20260619120000)가 DB 최종 방어선 | foundation §13 후속 필수 — 발송된 작업이 CANCELLED되는 불변식 위반 차단(양 끝 모두 원자화해야 닫힘) |
| D12 | **검증 = 하이브리드 3층**: 순수함수 단위 + 4종 HWPX `section0.xml` 정규화 diff + 수동 한컴 열기 게이트. Phase 0 골든은 day-sync 기존 산출물·템플릿에서 박제 | HWPX 무성 실패는 사람만 최종 확인(STRATEGY §5). 골든으로 회귀 자동 감지 |
| D13 | **다운로드는 `GeneratedFile.id`로 조회 후 resolve**(raw path 금지). 디렉터리면 ZIP, `Buffer`→`new Uint8Array` | 경로 주입 차단. billing outputPath는 디렉터리(§4) |

## 3. 모듈 구조와 경계

```
src/lib/storage/index.ts          # 신규 — STORAGE_ROOT·template/output 경로 해석·traversal 가드 (lib, 모듈 경계 밖)
src/lib/env/schema.ts             # 변경 — STORAGE_ROOT 추가
src/modules/workflows/
  validations/index.ts            # 변경 — billingConfig/roundDate zod 스키마
  repositories/
    index.ts                      # 변경 — commitGeneratedTransition(advisory lock+승격후 CAS+파일기록); cancel 원자 술어(GENERATED∧¬SENDING, H1)
    billing.ts                    # 신규 — BillingConfig/RoundDate repo 함수
    mail.ts                       # 변경 — createSendingDelivery에 task-status 가드(D11); finalize+transition 한 tx(G2b)
  services/
    lifecycle.ts                  # 변경 — cancel을 원자 조건부 UPDATE(GENERATED∧¬active-SENDING, H1)로 대체
    billing-config.ts             # 신규 — 설정 CRUD service(권한 ctx)
    billing-generator.ts          # 신규 — GeneratorPort 구현(HWPX 4종)
    generator-registry.ts         # 신규 — Record<WorkflowKind, GeneratorPort>
    generate.ts                   # 신규 — runGenerate(advisory lock 직렬화·kind 디스패치 orchestrator)
    send.ts                       # 신규 — runSend(단계별 첨부·양측 TOCTOU·finalize+전이 한 tx orchestrator)
    mail.ts                       # 변경 — deliver(onDeliveredTx, 상대 저장)·retryDelivery 첨부 resolveStoragePath strict(D8·I4)
  billing/period.ts               # 신규 — computeBillingPeriod 순수함수(전월·회차)
src/app/api/workflows/
  billing/config/route.ts                       # 신규 GET·POST
  billing/config/[year]/route.ts                # 신규 GET·PATCH·DELETE
  billing/config/[year]/rounds/route.ts         # 신규 GET
  billing/config/[year]/rounds/[round]/route.ts # 신규 PUT·DELETE
  [id]/generate/route.ts                         # 신규 POST(일반)
  [id]/send/route.ts                             # 신규 POST(일반)
  [id]/files/[fileId]/route.ts                   # 신규 GET(단일 파일)
  [id]/download/route.ts                         # 신규 GET(디렉터리 ZIP)
prisma/seed.ts                    # 변경 — WorkflowType(BILLING)
prisma/seed-permissions.ts        # 변경 — billing:configure/generate/send + 역할 grant
```

경계 규칙(eslint boundaries 유지):

- `workflows` 모듈은 `kernel`·`lib`·자기 모듈만 import. `lib/storage`는 lib이므로 워크플로가 공유 가능(모듈 경계 밖).
- Prisma 접근은 `workflows/repositories`에서만. 생성기·service는 repo 함수만 호출.
- 생성기 구현체(`billing-generator.ts`)는 `workflows` 모듈 안에 둔다(foundation §11: 구현체는 sub-project가 자기 모듈에).
- `computeBillingPeriod`·XML 치환 헬퍼는 순수 함수로 분리해 1층 단위 테스트 대상으로 둔다.

## 4. 파일 저장소 계층 (`src/lib/storage/`) — D2·D3·D13

### 4.1 디스크 레이아웃

```
$STORAGE_ROOT/
  Template/
    주간보고/  대금청구/  알림톡/        # git 비추적. 배포 시 서버 배치, 로컬·테스트는 fixtures
  out/
    workflows/<taskId>/                  # 산출물 (taskId 기반, D3)
  keys/                                  # 필요 시 형제로 유지(이 스펙 범위 밖)
```

### 4.2 DB 저장 규약 — storage-relative POSIX 경로만

| 컬럼 | 저장값 예시 |
| --- | --- |
| `WorkflowType.templatePath` | `Template/대금청구` |
| `WorkflowTask.outputPath` | `out/workflows/<taskId>` (디렉터리 포인터) |
| `GeneratedFile.path` | `out/workflows/<taskId>/(공문)....hwpx` |
| `MailDelivery.attachmentPaths` | `["out/workflows/<taskId>/(공문)....hwpx", ...]` |

절대경로·드라이브 경로·`..`는 DB에 저장하지 않는다.

### 4.3 헬퍼 API

```ts
export function getStorageRoot(): string;        // STORAGE_ROOT(절대경로). 미설정/상대면 throw
export function getTemplateRoot(): string;        // STORAGE_ROOT/Template
export function getOutputRoot(): string;          // STORAGE_ROOT/out
export function resolveStoragePath(stored: string): string;   // STRICT: Template/…|out/… 상대경로만 → 절대경로(가드). 절대경로·..·prefix불일치 모두 throw
export function resolveTemplatePath(rel: string): string;     // 대금청구/… → 절대경로(strict 기반)
export function resolveOutputPath(rel: string): string;       // workflows/<id>/… → 절대경로(strict 기반)
export function toStoredOutputPath(abs: string): string;      // STORAGE_ROOT/out 하위 절대경로 → out/… 상대경로. 하위가 아니면 throw(절대경로를 DB에 저장하지 않음, I4)
```

### 4.4 path traversal 가드 (보안 핵심) — F4·I4 반영: **모든 경로 strict, legacy 통과 없음**

**`resolveStoragePath`(STRICT)** — 다운로드·generate·send 첨부 수집·**메일 첨부 해석(deliver/retry)** 등 **모든 경로가 사용**:

- `getStorageRoot()`는 **절대경로만** 허용(상대·미설정 → 명확한 에러, fail-closed).
- `stored`가 `Template/` 또는 `out/`로 시작할 때만 `path.resolve(getStorageRoot(), stored)` 후 **결과가 root 하위인지 검사**(`resolved === root || resolved.startsWith(root + path.sep)`). 이탈 시 throw.
- **절대경로·드라이브 경로·`..` 포함·prefix 불일치는 전부 throw**(통과 없음).

**legacy 절대경로 통과 없음(I4)**: 메일 첨부 해석도 strict를 쓴다 — `MailDelivery.attachmentPaths`에 절대경로가 있으면(마이그레이션·운영 수정으로 유입돼도) **retry가 거부**되어, 절대경로가 이메일 첨부로 exfiltration되지 못한다. **신규 workflow delivery는 항상 storage-relative만 저장**한다(`deliver`가 `toStoredOutputPath`로 환원하며, STORAGE_ROOT/out 밖이면 저장 거부). leave는 첨부가 없고(`[]`) billing은 relative라 무손실. 과거 절대경로 row가 존재하면 **런타임 통과가 아니라 일회성 마이그레이션으로 정규화**(후속).

- day-sync `resolveOutputPath`/`toStoredOutputPath`를 그대로 복사하지 않는다 — `process.cwd()/output` 가정을 `STORAGE_ROOT/out` 기준으로 바꿔 포팅한다(D2).

### 4.5 env

`lib/env/schema.ts`에 `STORAGE_ROOT` 추가. **생성·발송·다운로드를 실제로 시도할 때 fail-closed**(미설정이면 명확한 도메인 에러). `lint`/`typecheck`/`build`/`test`는 DB 없이 통과해야 하므로(CLAUDE.md), 테스트는 `STORAGE_ROOT`를 tmp fixture로 주입한다.

## 5. 데이터·시드 — D4

스키마 변경 **없음**. `BillingConfig`/`BillingRoundDate`/`GeneratedFile`은 모두 선반영(BigInt 금액·`@@unique([year,round])`·`@@index([year])` 포함). 마이그레이션 불필요 → **표준 restart**.

### 5.1 `WorkflowType(BILLING)` 시드 (`seed.ts`, **kind 기준 upsert** — J3)

```ts
// kind는 @unique. id로 create하면 기존 row와 kind 충돌(seed-demo.ts가 이미 id="wf-billing"으로 BILLING 생성).
// 따라서 kind 기준 upsert로 templatePath/name/recurrence/defaultRecipients를 신규 저장소 규약으로 정규화한다.
prisma.workflowType.upsert({
  where: { kind: "BILLING" },
  update: { name: "대금청구", templatePath: "Template/대금청구", recurrence: "monthly" },  // stale templatePath(예: "Template/billing.hwpx") 정규화
  create: { id: "billing", kind: "BILLING", name: "대금청구", templatePath: "Template/대금청구",
            recurrence: "monthly", defaultRecipients: null, isActive: true },  // 수신자는 send 입력 우선(§9.2)
})
```

**AC(J3)**: 기존 DB(seed-demo BILLING row 존재)에서 seed가 충돌 없이 통과하고 `templatePath`가 `Template/대금청구`로 정규화됨을 검증.

### 5.2 권한·역할 (`seed-permissions.ts` `EXTRA_PERMISSIONS` + 멱등 upgrade)

`catalog.ts`의 `RESOURCES`에 `workflows.billing`, `ACTIONS`에 `configure`/`generate`/`send`/`view`가 이미 있다(카탈로그 변경 불필요). Permission row + 역할 grant:

- `workflows.billing:configure` — 설정 CRUD. grant: `pm`(+OWNER 자동).
- `workflows.billing:generate` — 생성. grant: `pm`.
- `workflows.billing:send` — 발송. grant: `pm`.
- `workflows.billing:view` — 조회·다운로드. grant: `pm`.

**기존(비어있지 않은) DB grant — H3**: `seed-permissions.ts`는 role-permission이 **비어있을 때만** 부트스트랩하고, 이후 grant는 **별도 멱등 upgrade helper**로 적용한다(기존 leave/teams/notification-toggle "upgrade-once" 패턴). 신규 Permission row만 생기고 pm grant가 누락되면 배포 후 신규 API가 **403 fail-closed**가 된다. 따라서 **billing 4개 권한을 pm에 부여하는 멱등 upgrade helper**를 추가하고, **모든 grant 성공 후에만 적용 플래그**를 기록한다(부분 적용 방지). 배포 `db:seed`가 이 upgrade를 실행해 dev/운영 기존 DB에서 pm이 billing 권한을 받음을 검증한다.

(주간보고가 이미 `workflows.weekly:view`로 `/workflows` NAV를 열어둔다 — NAV 변경 없음.)

## 6. 설정 CRUD 백엔드 — ③

### 6.1 validations (`validations/index.ts`, Zod 4)

- `billingConfigSchema`: `year`(int 2020~2100), `projectName`/`contractNumber`(min 1), `contractAmount`/`monthlyAmount`(**`z.coerce.bigint()` 양수**. `contractAmount ≤ MAX_SAFE_INTEGER`(F3), **`monthlyAmount ≤ floor(MAX_SAFE_INTEGER / 12)`**(J4 — 12회차 누계 `monthlyAmount*12`도 안전정수 내). 실제 계약 금액(원)은 이 한계를 훨씬 밑돌므로 가드 성격), `contractAmountKor`/`monthlyAmountKor`(min 1).
- `billingConfigUpdateSchema = billingConfigSchema.partial().omit({ year: true })`.
- `billingRoundDateUpdateSchema`: `submitDate`(ISO datetime).

### 6.2 repositories (`repositories/billing.ts`, 함수 export, `import "server-only"`)

- `findAllBillingConfig()` · `findBillingConfigByYear(year)` · `createBillingConfig(data)` · `updateBillingConfigByYear(year, data)` · `deleteBillingConfigByYear(year)`.
- `findRoundDatesByYear(year)` · `findRoundDate(year, round)` · `upsertRoundDate(year, round, submitDate)` · `deleteRoundDate(year, round)` · `deleteRoundDatesByYear(year)`.
- **삭제 연쇄**: `deleteBillingConfigByYear`는 `$transaction`으로 `deleteRoundDatesByYear(year)` → config 삭제를 원자 처리(day-sync는 순차 await였으나 ops-hub는 트랜잭션으로).

### 6.3 service (`services/billing-config.ts`)

- 권한 ctx(`{ isOwner, permissionKeys }`) 인자. 모든 변경(create/update/delete/round upsert/delete)은 `can(ctx, "workflows.billing", "configure")` 검사, 조회는 `:view`. fail-closed.
- BigInt 경계(D5): repo는 BigInt 그대로. API DTO 직렬화 시 `Number(amount)`.

### 6.4 API (`app/api/workflows/billing/config/**`)

| 메서드·경로 | 동작 | 권한 |
| --- | --- | --- |
| `GET /api/workflows/billing/config` | 목록 | `workflows.billing:view` |
| `POST /api/workflows/billing/config` | 생성(year 중복 409) | `:configure` |
| `GET /api/workflows/billing/config/[year]` | 단건 | `:view` |
| `PATCH /api/workflows/billing/config/[year]` | 수정 | `:configure` |
| `DELETE /api/workflows/billing/config/[year]` | 삭제(회차 연쇄) | `:configure` |
| `GET /api/workflows/billing/config/[year]/rounds` | 회차 목록 | `:view` |
| `PUT /api/workflows/billing/config/[year]/rounds/[round]` | 회차 저장/수정 | `:configure` |
| `DELETE /api/workflows/billing/config/[year]/rounds/[round]` | 회차 삭제 | `:configure` |

전부 `auth()` → `getPermissionSummary` → 권한 게이트. 봉투 없이 `NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })`, 에러는 `workflows/_shared.ts`의 `mapError`(403/409/400/404). day-sync `{success,data,message,error}` 봉투 제거.

## 7. HWPX 4종 생성기 — ④ (본체)

### 7.1 구조

`services/billing-generator.ts`에 `GeneratorPort` 구현(`kind: "BILLING"`). day-sync `lib/billing-hwpx-generator.ts`(~341줄) 포팅:

- `replaceInHwpx(absTemplatePath, replacements)`: `JSZip.loadAsync` → `Contents/section0.xml` 추출 → 치환 → `generateAsync`로 산출.
- `fillEmptyCell(xml, colAddr, rowAddr, text)` · `clearCellText(xml, colAddr, rowAddr)` · `fillGisungTable(xml, round, config, roundDateMap)`.
- `formatAmount` · `getRoundDD` · `getLastDayOfMonth` 등 순수 헬퍼.

### 7.2 생성 4종

| 키 | 문서 | 치환 |
| --- | --- | --- |
| gongmun | (공문)…유지관리 사업 | 단순 치환 |
| gisung | 붙임파일_기성계 | 치환 + 회차 테이블 동적 채움 |
| jumgum1 | 수탁 업체 개인정보 관리 실태 점검표 | 단순 치환 |
| jumgum2 | 정보화용역사업 보안관리 월별 점검표 | 단순 치환 |

- 템플릿: `resolveTemplatePath("대금청구/…(02월).hwpx")`. 출력: `resolveOutputPath("workflows/<taskId>/…")` → 디스크 기록 → `GeneratorResult.files`는 **storage-relative 경로**.
- 4종 산출물 파일명은 day-sync와 동등(골든 대조 위해).

### 7.3 날짜·회차 (`billing/period.ts` 순수함수, 전월 기준 보존 — D9·J2)

```ts
export function computeBillingPeriod(scheduledAt: Date): { projectYear: number; round: number; billingDate: Date };
```

- **timezone(J2)**: `scheduledAt`은 Prisma `DateTime`(UTC instant)다. **전월 계산은 반드시 Asia/Seoul 기준**으로 한다 — JS `Date`의 로컬 메서드(`getMonth`/`getFullYear`)를 그대로 쓰면 운영 서버 TZ가 KST가 아닐 때 월 경계가 어긋난다(예: `2026-03-01 00:00 KST = 2026-02-28T15:00Z` → UTC 서버는 2월로 읽어 회차/연도 오산 → 오청구). KST로 변환 후 전월의 연/월을 산정한다(기존 calendar 모듈의 KST 규약 재사용). **AC**: UTC·KST 서버 모두에서 동일 결과, 1월(전월=전년 12월) 경계, 월 첫날 자정(KST) 경계 테스트.
- `fillGisungTable`: 1~현재 round 행 채움. 1·2회차는 기존 행 날짜 치환, `round===1`이면 2회차 행(rowAddr=6) `clearCellText`. 3회차+는 `fillEmptyCell`로 colAddr별(1=제출일·2=기성금액·4=청구금액·6=누계). **누계 = `monthlyAmount * i`를 BigInt로 계산**(J4 — `Number` 곱셈 금지; 포맷 직전에만 문자열화). 회차 제출일 = `roundDateMap[round]`의 DD(없으면 청구일 DD).

### 7.4 HWPX 함정 보존 (D9)

- **XML 이스케이프**: 치환 *값*(`projectName`/`contractNumber`/`*Kor`)에 `& < > " '` 이스케이프. (마커 자체가 아니라 삽입 텍스트만 — split/replace 마커 매칭은 영향 없음.)
- **`String.replace` 콜백 회피**: `split(from).join(to)` 사용(`$&`/`$1` 토큰 해석 차단), RegExp 케이스만 `replace`.
- **분리된 run 태그**: 공문·기성계 청구금액이 두 `<hp:run>`으로 쪼개져 있어 태그 경계 포함 긴 문자열을 통째 치환 — 템플릿 버전 변경 시 깨지므로 골든·수동 게이트로 검증.
- **"02월 기준" 마커 의존**: `02월 10일`·`2026.02월분` 등 하드코딩 마커. 템플릿 교체 시 마커 동기화.
- 멀티라인 셀은 현재 미사용(필요 시 `<hp:p>` 블록 복제, ADR-0001).

## 8. generate 오케스트레이션 + GENERATED 전이 — ⑤·D10

### 8.1 generator 레지스트리

```ts
// services/generator-registry.ts
export const GENERATORS: Partial<Record<WorkflowKind, GeneratorPort>> = { BILLING: billingGenerator };
export function getGenerator(kind: WorkflowKind): GeneratorPort; // 미등록이면 명확한 도메인 에러(NotImplemented)
```

### 8.2 `runGenerate(taskId, ctx)` (`services/generate.ts`, 일반 kind 디스패치) — F1·G1·I2·I3 반영

동시 generate가 파일을 찢거나(torn write) **패배자가 승자 산출물을 덮어쓰거나**, **"GENERATED인데 파일 없음" 복구 불가 상태**가 되거나, **실패한 generation이 round date를 오염**시키는 것을 모두 막는다. 원칙: **(a) 직렬화는 DB 트랜잭션을 열어둔 채 하지 않는다**(I2 — FS I/O 동안 커넥션 점유 금지), **(b) GENERATED는 파일 승격 뒤에만 set**(G1), **(c) round-date 영속은 최종 commit tx 안에서 create-if-missing**(I3).

0. **taskId별 직렬화(H2·I2)** — `DEFERRED_TO_IMPL`, 단 **계약을 명시**(J1, primitive 선택은 impl이되 아래 속성을 모두 만족해야 하고 impl 단계 review-loop가 검증):
   - **직렬화**: 같은 taskId의 동시 generate는 정확히 하나만 진행, 나머지는 즉시 **409**(무한 대기 금지 = 타임아웃/try).
   - **FS 동안 DB tx/커넥션 미점유**: HWPX 생성·승격 동안 열린 트랜잭션을 들고 있지 않는다(풀 고갈 금지). DB는 **짧은 commit tx(step 4)만** 점유.
   - **연결 일관성(Prisma 함정 명시)**: session-level `pg_advisory_lock`/`pg_try_advisory_lock`을 쓰면 **lock·unlock·그 사이 작업이 같은 물리 커넥션이어야** 한다(`$transaction` interactive로 감싸면 FS 동안 tx 점유 = 금지에 위배; 풀에서 임의 커넥션으로 `$queryRaw` 두 번 호출하면 다른 커넥션이라 lock이 샌다). → **전용 커넥션 checkout + `try/finally` unlock + 타임아웃 + 크래시 시 자동 해제(session 종료로)** 를 계약화하거나, **lease 컬럼 방식**(필요 schema/만료/steal 규칙·CAS 쿼리 포함)을 택한다.
   - **AC**: 동시 2건 중 1건만 진행·1건 409, FS 지연이 커넥션 풀을 고갈시키지 않음, 보유자 크래시 후 lock 자동 해제(다음 generate 가능). **두 후보(advisory-lock-on-dedicated-connection / lease-column) 중 하나를 impl plan에서 확정**하고 위 AC로 검증.
1. task 조회 + lock 획득 후 **status가 PENDING이 아니면 ConflictError**(권한 `can(ctx, KIND_RESOURCE[kind], "generate")` fail-closed). lock 덕에 승격하는 요청은 하나뿐.
2. `getGenerator(kind).generate(task, tmpDir)` — **요청별 임시 디렉터리**(`out/workflows/.tmp/<taskId>-<reqId>/`)에 HWPX 기록, 산출 파일 목록(최종 상대경로 = `out/workflows/<taskId>/…`) 반환. **이 단계는 DB tx 밖**(순수 FS·zip). **round-date는 여기서 건드리지 않는다(I3).**
3. **승격(promote, atomic rename)**: 임시 디렉터리를 `out/workflows/<taskId>/`로 옮긴다. 최종 디렉터리가 이미 있으면(이전 시도 크래시 잔재) **원자 교체**(기존 final → 유니크 trash rename → tmp → final rename → trash 삭제 — 각 rename 원자적, live 디렉터리에 직접 쓰지 않아 torn write 없음). 직렬화돼 있어 경쟁 승격 없음.
4. **짧은 최종 commit tx**: `updateMany({ where:{ id, status:"PENDING" }, data:{ status:"GENERATED", generatedAt, outputPath } })` → 0행이면 ConflictError → `createGeneratedFiles`(최종 경로) → `WorkflowTaskEvent`(PENDING→GENERATED) → **(billing) `createRoundDateIfMissing(computeBillingPeriod(scheduledAt))`**(I3 — 성공 commit 경로에서만, **기존 행 덮어쓰기 금지**). 이 tx만 짧게 DB를 점유한다(`commitGeneratedTransition`).
5. 에러·예외·CAS 패배 시 임시/trash 디렉터리 **cleanup**, lock 해제.

**복구성(G1)**: GENERATED는 승격(3) 성공 후에만 set → "GENERATED인데 파일 없음" 미발생. 승격 후 commit 전 크래시는 status를 **PENDING으로 남겨**(파일은 최종 위치) → 재생성이 정상 진행. round-date는 commit tx 안에서만 기록되므로 **실패한 generation은 round date를 바꾸지 않는다(I3)**.

**AC**: 동시 generate 2건 → 직렬화로 1건만 GENERATED·파일 1세트, 진 요청 409 + cleanup(승자 final 미변경); 승격 후 commit 전 중단 → 재생성 복구; **generation 실패 시 `BillingRoundDate` 불변**(I3); lock 경합 시 빠른 409(FS 지연이 커넥션 미점유, I2).

### 8.3 라우트

`POST /api/workflows/[id]/generate` (일반). `auth()` → summary → `runGenerate(id, ctx)`. 권한은 `runGenerate` 내부에서 kind별로 게이트.

## 9. send 오케스트레이션 + 단계별 첨부 — ⑤·D7·D8·D11

### 9.1 단계별 첨부 규칙 (day-sync §4 정확 재현)

| 단계 | 전이 | 첨부 | 이 슬라이스 |
| --- | --- | --- | --- |
| 1 (고객 승인요청) | GENERATED→SENT | 출력 디렉터리 내 `.hwpx`(+`.xlsx`) — 대금청구는 hwpx 4종만 | **포함** |
| 2 (본사 서류요청) | SENT→HQ_REQUESTED | **첨부 없음** | **포함** |
| 3 (최종 발송) | HQ_REQUESTED→FINAL_SENT | 사용자 업로드 파일만 | **이전(F2)** — 후속 UI spec |

**F2 반영 — 3단계(FINAL_SENT) 발송은 이 슬라이스에서 제외한다.** 3단계 첨부는 본질적으로 **사용자 업로드 파일**이라, 업로드 artifact를 받아 저장·검증하는 backend 계약 없이는 안전하게 구현할 수 없다(첨부 없이 발송되거나 raw path 우회 위험). 업로드는 UI 주도이므로 D1(UI 분리)·D7과 일관되게 **후속 UI spec으로 이전**한다. 이 슬라이스의 `runSend`는 **1·2단계만** 지원하고, `transitionTask(FINAL_SENT)` 전이 자체는 정책상 유지(테스트는 직접 호출로 검증 가능).

- 1단계 첨부 수집: `outputPath`(디렉터리)를 **`resolveStoragePath`(strict)** 로 절대화 → `readdirSync` → 확장자 필터 → **상대경로로 환원**해 `attachmentPaths`에 저장(D2).
- 알림톡(`.xlsx` 제외)과 혼동 금지. 2단계 무첨부 누락 주의.

### 9.2 `runSend(taskId, { step, subject, body }, ctx)` (`services/send.ts`) — 1·2단계 한정

1. 권한 `can(ctx, KIND_RESOURCE[kind], "send")` 검사(라우트 진입 직후, fail-closed — `deliver`는 자체 authz 없음).
2. `step`은 **1 또는 2만 허용**(3단계 요청은 `NotImplemented`/422 — 후속 UI spec). 단계별 목표 status 결정 + 첨부 목록 산출(§9.1). **수신자(I1)**: `body.recipients ?? task.recipients ?? type.defaultRecipients`로 해석하고, **결과가 비어 있으면 `MailDelivery` 생성 전 400/409로 거부**(빈/null 수신자로 SMTP 도달·오해성 발송 기록 방지). subject/body/recipients 모두 **caller 제공**(D7·백엔드 우선이라 task.recipients를 채울 UI가 없으므로 send 입력으로 받음). 해석된 수신자는 zod로 형식 검증.
3. **선(先) TOCTOU 가드 점유(D11)**: `createSendingDelivery`를 **task-status 가드와 한 트랜잭션**으로 — 현재 status가 이 단계의 `fromStatus`(1단계=GENERATED, 2단계=SENT)이고 활성 SENDING이 없을 때만 SENDING 레코드 생성. CANCELLED/비-sendable이면 ConflictError. (foundation `createSendingDelivery`에 expected fromStatus 조건 추가 — foundation §13 후속 "cancel vs 동시 발송 TOCTOU" 이행.) 동시 중복은 `(taskId,step)` partial unique index가 DB 레벨 최종 방어선(foundation, 마이그레이션 `20260619120000`에 존재).
4. 첨부 상대→절대(**`resolveStoragePath` strict**) 후 SMTP 발송. **발송 직전~직후 내내 delivery는 SENDING 유지** → `hasActiveSending`이 이를 관측해 cancel을 계속 차단.
5. **후(後) 원자 확정(G2b)**: SMTP 성공 시 `finalizeDelivery(SENT)` + `transitionTask(targetStatus)`를 **한 DB 트랜잭션**으로 처리한다. SENDING이 이 tx 직전까지 유지되므로 "delivery=SENT인데 task 미전이"인 cancel 침투 창이 없다(메일 발송된 작업이 CANCELLED되는 것 차단). SMTP 실패 시 `finalizeDelivery(FAILED)`만, 전이 없음(발송 실패가 전이를 막지 않음). SMTP 성공 후 이 tx가 실패하면 **SENDING으로 남기고 에러 전파**(FAILED 둔갑 금지 — 중복 발송 방지, admin resolve, foundation §6.2·§6.3). `sentAt`은 SENT에서만 stamp.
   - 구현: foundation `deliver`를 **선택적 `onDeliveredTx`(finalize와 같은 tx에서 실행할 전이)** 를 받도록 확장하거나, send 오케스트레이션이 `createSendingDelivery`(guarded) + `sendMail` + `finalize+transition` 한 tx를 직접 조립한다. 기본(전이 없음) 동작은 불변 — leave 등 기존 소비자 영향 없음.

### 9.2.1 cancel 측 원자 술어 (H1) — send/cancel 상호배제 완성

D11의 send-측 가드(SENDING 선기록을 status=GENERATED 조건으로 점유)만으로는 부족하다 — **cancel의 `hasActiveSending` precheck와 status CAS가 분리**돼 있어, cancel이 "SENDING 없음"을 읽은 직후 send가 SENDING을 삽입하고 SMTP를 보내도, cancel의 뒤이은 `GENERATED→CANCELLED` CAS가 여전히 성공할 수 있다(발송된 작업이 CANCELLED). **cancel 측도 원자화**한다:

- cancel 전이를 **`UPDATE WorkflowTask SET status='CANCELLED' WHERE id=? AND status='GENERATED' AND NOT EXISTS (SELECT 1 FROM "MailDelivery" WHERE "taskId"=? AND status='SENDING')`** 형태의 **단일 조건부 UPDATE**(raw)로 수행 — SENDING 존재 검사를 CAS와 한 문장에 묶는다.
- 그러면 send-측 점유(SENDING 삽입, status=GENERATED 조건)와 cancel-측(GENERATED ∧ ¬SENDING)이 **순서와 무관하게 상호배제**: 먼저 commit한 쪽이 이긴다. cancel 먼저면 send의 SENDING 삽입이 status≠GENERATED로 차단(SMTP 미발생). send 먼저면 cancel이 SENDING 존재로 0행(차단).
- foundation `transitionTask`의 CANCELLED 경로(`hasActiveSending` 별도 precheck + CAS)를 이 원자 술어로 대체한다(foundation §13 후속 이행). **AC**: cancel이 precheck를 통과한 뒤 SENDING이 삽입되고 cancel이 commit을 시도하는 인터리빙에서 cancel이 거부됨을 동시성 테스트로 보장.

### 9.3 mail.ts 적응 (D8, 공유 코드) — F4·I4 반영: 첨부도 strict

- `deliver`: `args.msg.attachments[].path`는 **절대경로**로 받아 SMTP에 사용하고, **DB 저장(`createSendingDelivery`)에는 `toStoredOutputPath(a.path)` 결과(storage-relative)**를 넣는다. STORAGE_ROOT/out 밖 첨부면 저장 거부(신규 row는 절대경로 미저장, I4).
- `retryDelivery`: 저장된 `attachmentPaths`를 **`resolveStoragePath`(strict)** 로 절대화한 뒤 `existsSync`·`sendMail`. **절대경로 row는 거부**(exfiltration 차단, I4).
- **leave 발송 회귀 테스트**: leave 알림 메일(첨부 없음 `[]`)이 적응 후에도 그대로 통과함을 보장. **AC**: 절대경로 첨부 row의 retry가 거부됨.

### 9.4 라우트

`POST /api/workflows/[id]/send` (일반). body: `{ step, subject, body, recipients }`, `step ∈ {1,2}`(zod enum, 3은 거부 — F2), `recipients`는 이메일 배열(빈 배열·미해석 시 400 — I1). 권한은 `runSend` 내부 kind별 게이트.

## 10. 다운로드 API — ⑥·D13

- `GET /api/workflows/[id]/files/[fileId]`: `GeneratedFile.id`로 조회(raw path 금지) → task 소속·`<kind>:view` 권한 → **`resolveStoragePath`(strict)** `(file.path)` → 스트리밍(`Content-Disposition` = `displayName`, `Buffer`→`new Uint8Array`).
- `GET /api/workflows/[id]/download`: `outputPath` 디렉터리 전체 ZIP. **`resolveStoragePath`(strict)** → `statSync().isDirectory()` 분기 → `readdirSync` → JSZip로 묶어 스트리밍.
- **다운로드는 strict resolver만 사용**(F4): `file.path`/`outputPath`가 절대경로면(마이그레이션·시드·운영 수정으로 유입돼도) **throw → 다운로드 거부**. legacy 절대경로 통과는 mail 첨부(`resolveAttachmentPath`)에만 있고 다운로드 경계와 분리.
- **AC**: `GeneratedFile.path`가 절대경로/`..`인 행은 다운로드가 거부됨을 테스트로 보장.
- 권한 없거나 파일/디렉터리 부재 시 404/403(조용한 실패 금지).

## 11. 에러 처리

- 도메인 에러 클래스(`ConflictError` 등) → `mapError`(403/409/400/404).
- 명시적 fail-closed 에러: `STORAGE_ROOT` 미설정, 템플릿 파일 부재, `BillingConfig` 부재(생성 시), 미등록 kind generator, path traversal 위반. 모두 조용한 실패 금지 — 명확한 메시지.

## 12. 검증 전략 — ⑦·D12 (하이브리드 3층)

TDD(실패 테스트 → FAIL 확인 → 최소 구현 → PASS → commit). node 환경, DB·SMTP·파일시스템은 fake/tmp.

### Phase 0 — 골든 캡처 (day-sync 폐기 전, 시한부)

- day-sync `Template/대금청구/*.hwpx`(템플릿 4종) + 기존 `output/billing-*/`(정답 산출물)을 `tests/golden/billing/`(입력 config + 기대 산출 쌍)으로 박제. **day-sync 재실행 없이 확보 가능**(이미 존재 확인됨).
- 박제한 config(projectName·계약번호·금액·`*Kor`·회차 제출일)를 generator 입력 fixture로 사용.

### 1층 — 단위(vitest)

- `computeBillingPeriod`(전월·회차), `fillGisungTable` 행·열·누계 매핑, BigInt→Number 경계, `resolveStoragePath` traversal 가드(이탈·`..`·절대 통과·prefix 위반), XML 이스케이프, 회차 자동 upsert 호출.

### 2층 — 골든

- 생성한 4종 HWPX를 ZIP 해제 → `Contents/section0.xml` **정규화(공백·요소순서) 후 텍스트 diff**로 골든과 비교. 회귀 자동 감지.

### 3층 — 수동 게이트 (기능 "완료" 전)

- 생성물을 **한컴에서 실제 열기**(무성 실패 최종 확인). 메일 제목/본문/수신자/첨부 눈 대조(1단계=hwpx 4종, 2단계=무첨부). **3단계(업로드)는 후속 UI spec(F2).**
- 상태 전이 재현: GENERATED→SENT→HQ_REQUESTED(발송 경로). HQ_REQUESTED→FINAL_SENT는 전이만 검증(발송은 후속).

### 동시성·authz·라우트

- **generate**: 동시 generate 2건 → 1건만 GENERATED·파일 1세트, 진 요청 409 + 임시 디렉터리 cleanup(F1). **send** TOCTOU(CANCELLED 후 발송 거부, D11), step 3 요청 거부(F2). **다운로드**: 절대경로/`..` 행 거부(F4). 권한 게이트(보유 kind만·fail-closed), leave 발송 회귀(D8), 삭제 연쇄(config 삭제 시 회차 동반 삭제), BigInt refine 경계(F3).

게이트(각 태스크 AC): `npm run typecheck` / `npm run lint`(boundaries) / `npm test` / `npm run build`. 스키마 변경 없음(D4).

## 13. 비목표·후속

### 비목표 (명시)

- 설정 UI·단계별 메일 템플릿·주간보고/알림톡 생성기(D1·D7·D6 후속).
- durable outbox·백그라운드 워커·자동 보상기는 도입하지 않는다(foundation D3·§13 계승).
- day-sync `lib/hwpx-generator.ts`(`{{key}}` 범용 치환)는 대금청구 미사용 — 옮기지 않는다.

### 후속

- **설정 UI**(`/workflows/billing/settings`): React Query + ops-hub 프리미티브로 day-sync 610줄 page 재작성. 봉투 제거에 맞춰 `json.success` 분기도 제거.
- **3단계(FINAL_SENT) 최종 발송 + 업로드 artifact 계약**(F2): 업로드 endpoint(저장 위치 `out/workflows/<taskId>/uploads/` 등), `GeneratedFile.id[]`/upload id 기반 첨부 선택, task 소속·kind·stage·확장자·존재 검증, 첨부 없으면 409. UI와 함께.
- **단계별 메일 제목/본문 템플릿** + 발송 메일 골든 대조(텍스트 출처 확정 후).
- mail 첨부 절대경로 row 정규화: 과거/유입된 절대경로 `attachmentPaths`가 있으면 일회성 마이그레이션으로 storage-relative로 정규화(런타임 통과 없음, I4).
- 주간보고·알림톡 sub-project가 `GENERATORS` 레지스트리에 등록만으로 generate/send/download 라우트 재사용.
- 운영 cutover 시 과거 `BillingConfig`/`BillingRoundDate` 데이터 이전(Phase 6).
- AI 서명 없는 commit(글로벌 규칙).

## 14. 적대검증 ledger (spec 단계, R1~R5)

blocking score 추세: R1=8 → R2=6 → R3=7 → R4=10 → R5=8. R4/R5에서 비감소 → 판정 루프 전환(더 FIXED로 쫓지 않고 닫음). 5회(max) 도달로 종료.

| ID | round | 결함 | sev | disposition | 닫은 방법 / 연결 |
| --- | --- | --- | --- | --- | --- |
| F1 | R1 | 동시 generate FS 레이스 | high | FIXED | 임시 디렉터리→atomic 승격 (§8.2, 이후 H2·I2로 강화) |
| F2 | R1 | 3단계 업로드 첨부 계약 부재 | high | FIXED(범위 축소) | send 1·2단계 한정, FINAL_SENT는 후속 UI spec(§9.1·§13) |
| F3 | R1 | BigInt→Number 미강제 | medium | FIXED | Zod refine ≤ MAX_SAFE_INTEGER (§6.1, J4로 보강) |
| F4 | R1 | absolute pass-through ↔ 다운로드 경계 혼재 | medium | FIXED | strict/(이후 I4) 전면 strict (§4.4) |
| G1 | R2 | GENERATED 커밋이 승격보다 먼저 → 복구 불가 | high | FIXED | 승격→커밋 순서, GENERATED는 파일 안착 후만 (§8.2) |
| G2a | R2 | (taskId,step) DB 유니크 부재 | high | ACCEPTED(오탐) | partial unique index 마이그 20260619120000에 이미 존재 |
| G2b | R2 | SENT 확정·전이 분리 → cancel 침투 | high | FIXED | finalize+transition 한 tx, SENDING 유지 (§9.2) |
| H1 | R3 | cancel 측 비원자 | high | FIXED | cancel을 GENERATED∧¬SENDING 단일 조건부 UPDATE (§9.2.1) |
| H2 | R3 | CAS 패배자가 승자 파일 덮어쓰기 | high | FIXED | 직렬화(이후 I2·J1로 contract 강화) (§8.2) |
| H3 | R3 | 기존 DB에 신규 grant 미적용 | medium | FIXED | 멱등 upgrade helper (§5.2) |
| I1 | R4 | 수신자 없이 SMTP 도달 | high | FIXED | recipients send 입력 + 빈 수신자 400/409 (§9.2·§9.4) |
| I2 | R4 | advisory_xact_lock이 FS 내내 tx 점유 | high | FIXED | FS는 tx 밖, 짧은 commit tx만 (§8.2, primitive는 J1) |
| I3 | R4 | 실패한 generation이 round date 오염 | high | FIXED | round-date를 commit tx로·create-if-missing (§8.2·D10) |
| I4 | R4 | legacy absolute 첨부 메일 exfiltration | medium | FIXED | 첨부 해석도 strict, legacy 통과 제거 (§4.4·§9.3) |
| **J1** | **R5** | **generate 직렬화 primitive 미정(Prisma 커넥션 pinning)** | **high** | **DEFERRED_TO_IMPL** | **§8.2 step 0에 계약(직렬화·tx 미점유·연결 일관성·크래시 해제)+AC 명시. impl plan에서 advisory-lock-on-dedicated-connection / lease-column 중 확정, impl review-loop가 검증** |
| J2 | R5 | 전월 회차가 서버 timezone 의존(오청구) | high | FIXED | computeBillingPeriod Asia/Seoul + 경계 테스트 (§7.3) |
| J3 | R5 | WorkflowType seed가 seed-demo와 kind 충돌 | medium | FIXED | kind 기준 upsert + templatePath 정규화 (§5.1) |
| J4 | R5 | 누계 overflow(MAX_SAFE_INTEGER 밖) | medium | FIXED | 금액 산술 BigInt + monthlyAmount ≤ MAX/12 refine (§6.1·§7.3) |

**impl 진입 전 연결(필수)**: J1(DEFERRED_TO_IMPL)을 impl plan의 task/AC로 가져간다 — 직렬화 primitive 확정 + §8.2 step 0의 AC(동시 2건 1진행·1 409, FS 지연 풀 미고갈, 보유자 크래시 후 해제) 테스트. F1·G1·H2·I2 계열(generate 동시성)과 G2b·H1(send/cancel)·I3(round-date tx)·J2(timezone)의 동시성·경계 테스트도 impl AC로 명시.
