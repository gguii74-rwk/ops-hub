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
| D2 | **파일 저장소 = `STORAGE_ROOT` env 1개 + `lib/storage` 헬퍼.** DB엔 storage-relative POSIX 경로만 저장. resolver는 **strict(절대경로 거부, 모든 신규 경로)** 와 **legacy(절대 통과, 메일 첨부 전용)** 로 분리(F4) | 공유 스토리지를 릴리즈와 분리(CLAUDE.md). 절대경로 누출·경로 주입 차단 |
| D3 | **출력 레이아웃 = `out/workflows/<taskId>/`** (taskId 기반). day-sync `billing-{YYYYMM}/` 폐기 | taskId가 유일 키 — 같은 달 재생성·다중 작업 충돌 방지. 다운로드가 task로 귀속 |
| D4 | **스키마 변경 없음**(모델 선반영) → 표준 restart. `WorkflowType(BILLING)` 시드 + 권한/역할은 `seed-permissions.ts` `EXTRA_PERMISSIONS` | 비파괴 — full-stop 마이그레이션 불필요. foundation §13 후속 이행 |
| D5 | **BigInt 경계**: DB는 BigInt 유지, 생성기 입력·API DTO는 `Number()`. **Zod refine으로 `<= Number.MAX_SAFE_INTEGER` 강제**(F3)해 Number() 경계를 검증으로 보장 | Prisma가 bigint 반환·`JSON.stringify`가 bigint 거부. 가정이 아닌 강제 — 큰 금액 조용한 변조 차단 |
| D6 | **generate/send/download 라우트 일반화**(kind 디스패치) + `Record<WorkflowKind, GeneratorPort>` 레지스트리. billing만 등록, 미등록 kind는 명확한 에러 | 후속 sub-project가 라우트 3벌 복제 없이 재사용. 마이그레이션 문서의 port+레지스트리 패턴 |
| D7 | **메일 제목/본문은 caller 제공**(A안). 단계별 기본 템플릿·발송 골든 대조는 후속 UI spec | day-sync `send.service`도 subject/body를 인자로 받음 — 텍스트 출처는 UI. 백엔드는 첨부 규칙·전이만 책임 |
| D8 | **`mail.ts` 수술적 적응**: `deliver`는 `toStoredOutputPath`로 상대 저장, `retryDelivery`는 **`resolveAttachmentPath`(legacy)** 로 절대화. 절대 통과는 메일 첨부에만(다운로드는 strict, F4) | attachmentPaths 상대경로 일원화(D2)와 기존 `existsSync`/`sendMail` 조화. leave 발송 회귀 테스트로 보호 |
| D9 | **HWPX 치환에 사용자 입력 XML 이스케이프 추가**(`& < > " '`). split/join 치환·분리 run 마커·"02월 기준" 마커·전월 회차 계산 보존 | day-sync는 신뢰 설정값이라 미적용했으나 ops-hub는 입력 신뢰도가 낮음. 누락 시 한컴 무성 실패 |
| D10 | **회차 자동 upsert는 billing generator가 소유**(생성 직후, 멱등). 파일 기록 + GENERATED 전이는 orchestrator가 CAS-in-tx로 원자화 | 누락 시 과거 회차 날짜 전부 폴백(§8). 멱등이라 비원자 순서 안전. 동시 generate 중복 파일행은 CAS로 차단 |
| D11 | **send TOCTOU 가드(양끝)**: ①선-SMTP — SENDING 선기록을 task-status(sendable) 가드와 한 tx로 점유. ②후-SMTP(G2b) — finalize(SENT)+transition을 한 tx로, 그때까지 SENDING 유지. `(taskId,step)` partial unique(마이그 20260619120000)가 DB 최종 방어선 | foundation §13 후속 필수 — cancel 가능 상태(GENERATED)에서 발송과 cancel 경합·발송된 작업 CANCELLED 차단 |
| D12 | **검증 = 하이브리드 3층**: 순수함수 단위 + 4종 HWPX `section0.xml` 정규화 diff + 수동 한컴 열기 게이트. Phase 0 골든은 day-sync 기존 산출물·템플릿에서 박제 | HWPX 무성 실패는 사람만 최종 확인(STRATEGY §5). 골든으로 회귀 자동 감지 |
| D13 | **다운로드는 `GeneratedFile.id`로 조회 후 resolve**(raw path 금지). 디렉터리면 ZIP, `Buffer`→`new Uint8Array` | 경로 주입 차단. billing outputPath는 디렉터리(§4) |

## 3. 모듈 구조와 경계

```
src/lib/storage/index.ts          # 신규 — STORAGE_ROOT·template/output 경로 해석·traversal 가드 (lib, 모듈 경계 밖)
src/lib/env/schema.ts             # 변경 — STORAGE_ROOT 추가
src/modules/workflows/
  validations/index.ts            # 변경 — billingConfig/roundDate zod 스키마
  repositories/
    index.ts                      # 변경 — commitGeneratedTransition(파일기록+CAS+stamp 원자)
    billing.ts                    # 신규 — BillingConfig/RoundDate repo 함수
    mail.ts                       # 변경 — createSendingDelivery에 task-status 가드(D11)
  services/
    billing-config.ts             # 신규 — 설정 CRUD service(권한 ctx)
    billing-generator.ts          # 신규 — GeneratorPort 구현(HWPX 4종)
    generator-registry.ts         # 신규 — Record<WorkflowKind, GeneratorPort>
    generate.ts                   # 신규 — runGenerate(kind 디스패치 orchestrator)
    send.ts                       # 신규 — runSend(단계별 첨부·TOCTOU·전이 orchestrator)
    mail.ts                       # 변경 — deliver/retryDelivery 첨부 resolveStoragePath(D8)
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
export function toStoredOutputPath(abs: string): string;      // STORAGE_ROOT/out 하위 절대경로 → out/… 상대경로. 그 외 절대경로는 그대로 통과(메일 첨부 legacy 전용)
export function resolveAttachmentPath(stored: string): string;// LEGACY 허용: 상대면 strict resolve, 이미-절대면 통과. mail deliver/retry 전용(D8·F4)
```

### 4.4 path traversal 가드 (보안 핵심) — F4 반영: strict / legacy 분리

**`resolveStoragePath`(STRICT, 기본)** — 다운로드·generate·send 첨부 수집 등 **모든 신규 경로가 사용**:

- `getStorageRoot()`는 **절대경로만** 허용(상대·미설정 → 명확한 에러, fail-closed).
- `stored`가 `Template/` 또는 `out/`로 시작할 때만 `path.resolve(getStorageRoot(), stored)` 후 **결과가 root 하위인지 검사**(`resolved === root || resolved.startsWith(root + path.sep)`). 이탈 시 throw.
- **절대경로·드라이브 경로·`..` 포함·prefix 불일치는 전부 throw**(통과 없음). DB row가 마이그레이션·시드·운영 수정으로 절대경로를 담고 있어도 다운로드가 STORAGE_ROOT 밖을 읽지 못한다.

**`resolveAttachmentPath`(LEGACY 허용)** — **오직 `mail.ts`의 첨부 해석(deliver/retry)에서만 사용**(D8):

- 상대경로(`out/…`)면 strict와 동일하게 resolve. **이미-절대경로면 통과**(leave가 과거에 절대경로 첨부를 저장했을 수 있는 하위호환). 이 통과는 다운로드 경계와 **물리적으로 분리**되어, 절대경로 허용이 파일 다운로드로 새지 않는다.
- (향후 cutover 정리: leave 첨부도 상대경로로 정규화되면 이 legacy 통과를 제거할 수 있다 — 후속.)
- day-sync `resolveOutputPath`/`toStoredOutputPath`를 그대로 복사하지 않는다 — `process.cwd()/output` 가정을 `STORAGE_ROOT/out` 기준으로 바꿔 포팅한다(D2).

### 4.5 env

`lib/env/schema.ts`에 `STORAGE_ROOT` 추가. **생성·발송·다운로드를 실제로 시도할 때 fail-closed**(미설정이면 명확한 도메인 에러). `lint`/`typecheck`/`build`/`test`는 DB 없이 통과해야 하므로(CLAUDE.md), 테스트는 `STORAGE_ROOT`를 tmp fixture로 주입한다.

## 5. 데이터·시드 — D4

스키마 변경 **없음**. `BillingConfig`/`BillingRoundDate`/`GeneratedFile`은 모두 선반영(BigInt 금액·`@@unique([year,round])`·`@@index([year])` 포함). 마이그레이션 불필요 → **표준 restart**.

### 5.1 `WorkflowType(BILLING)` 시드 (`seed.ts`, create-if-absent)

```ts
{ id: "billing", kind: "BILLING", name: "대금청구", templatePath: "Template/대금청구",
  recurrence: "monthly", defaultRecipients: null, isActive: true }  // 수신자는 task.recipients 우선(§9.2). 시드 기본은 null
```

### 5.2 권한·역할 (`seed-permissions.ts` `EXTRA_PERMISSIONS`)

`catalog.ts`의 `RESOURCES`에 `workflows.billing`, `ACTIONS`에 `configure`/`generate`/`send`/`view`가 이미 있다(카탈로그 변경 불필요). Permission row + 역할 grant를 `EXTRA_PERMISSIONS`에 추가:

- `workflows.billing:configure` — 설정 CRUD. grant: `pm`(+OWNER 자동).
- `workflows.billing:generate` — 생성. grant: `pm`.
- `workflows.billing:send` — 발송. grant: `pm`.
- `workflows.billing:view` — 조회·다운로드. grant: `pm`.

(주간보고가 이미 `workflows.weekly:view`로 `/workflows` NAV를 열어둔다 — NAV 변경 없음.)

## 6. 설정 CRUD 백엔드 — ③

### 6.1 validations (`validations/index.ts`, Zod 4)

- `billingConfigSchema`: `year`(int 2020~2100), `projectName`/`contractNumber`(min 1), `contractAmount`/`monthlyAmount`(**`z.coerce.bigint()` 양수 + `.refine(v => v <= BigInt(Number.MAX_SAFE_INTEGER))`** — F3: Number() 경계 안전 보장. 실제 계약 금액(원)은 이 한계를 훨씬 밑돌므로 가드 성격), `contractAmountKor`/`monthlyAmountKor`(min 1).
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

### 7.3 날짜·회차 (`billing/period.ts` 순수함수, 전월 기준 보존 — D9)

```ts
export function computeBillingPeriod(scheduledAt: Date): { projectYear: number; round: number; billingDate: Date };
// prevDate = new Date(y, m-1, 1); projectYear = prevDate.getFullYear(); round = prevDate.getMonth()+1
```

- `fillGisungTable`: 1~현재 round 행 채움. 1·2회차는 기존 행 날짜 치환, `round===1`이면 2회차 행(rowAddr=6) `clearCellText`. 3회차+는 `fillEmptyCell`로 colAddr별(1=제출일·2=기성금액·4=청구금액·6=누계). **누계 = `monthlyAmount * i`**. 회차 제출일 = `roundDateMap[round]`의 DD(없으면 청구일 DD).

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

### 8.2 `runGenerate(taskId, ctx)` (`services/generate.ts`, 일반 kind 디스패치) — F1·G1 반영: **승격 → 커밋 순서**

동시 generate가 같은 `out/workflows/<taskId>/`에 동시에 써서 파일이 찢기거나(torn write) DB·디스크가 어긋나는 것을 막고, **"GENERATED인데 파일 없음" 같은 복구 불가 상태가 절대 생기지 않게** 한다. 핵심: **GENERATED는 파일이 최종 위치에 안착(승격)한 뒤에만 set한다.** 디스크 쓰기 → 승격 → CAS 커밋 순서.

1. task 조회. 권한 `can(ctx, KIND_RESOURCE[kind], "generate")` 검사(fail-closed). **status가 PENDING이 아니면 ConflictError**(중복 생성 방지).
2. `getGenerator(kind).generate(task, tmpDir)` — **요청별 임시 디렉터리**(`out/workflows/.tmp/<taskId>-<reqId>/`)에 HWPX 기록, **billing generator가 현재 회차 `upsertRoundDate`(멱등, D10)**, 산출 파일 목록(최종 상대경로 = `out/workflows/<taskId>/…`) 반환.
3. **승격(promote, atomic rename)**: 임시 디렉터리를 `out/workflows/<taskId>/`로 옮긴다. 최종 디렉터리가 이미 있으면(이전 시도 잔재·동시 generate) **원자 교체**(기존 final → 유니크 trash로 rename → tmp → final rename → trash 삭제 — 각 rename은 원자적, live 디렉터리에 직접 쓰지 않아 torn write 없음).
4. **DB 트랜잭션(원자, CAS-in-tx)**: `updateMany({ where:{ id, status:"PENDING" }, data:{ status:"GENERATED", generatedAt, outputPath:"out/workflows/<id>" } })` → 0행이면 ConflictError(동시 generate에서 진 요청; 승격된 파일은 결정적이라 승자 산출물과 동일 바이트 → 무해) → `createGeneratedFiles`(최종 경로) → `WorkflowTaskEvent`(PENDING→GENERATED). (`repositories/index.ts`에 `commitGeneratedTransition` 추가.)
5. 에러·예외·CAS 패배 시 임시/trash 디렉터리 **cleanup**(승자 산출물 미손상).

**복구성(G1)**: GENERATED는 승격(3) 성공 후에만 set되므로 "GENERATED인데 파일 없음" 상태가 발생하지 않는다. 승격 후 CAS 전 크래시는 status를 **PENDING으로 남겨**(파일은 최종 위치에 있음) → 재생성이 PENDING에서 정상 진행(재승격은 결정적이라 동일 바이트로 덮음) → 별도 보상/repair 경로 불필요. 회차 upsert는 멱등이라 재생성 안전.

**AC**: 동시 generate 2건 → 정확히 1건만 GENERATED·파일 1세트, 진 요청 409 + 임시/trash cleanup(잔여 없음); 승격 후 커밋 전 중단을 모사 → 재생성으로 복구(GENERATED-without-files 미발생).

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
2. `step`은 **1 또는 2만 허용**(3단계 요청은 `NotImplemented`/422 — 후속 UI spec). 단계별 목표 status 결정 + 첨부 목록 산출(§9.1). 수신자 = `task.recipients ?? type.defaultRecipients`. subject/body는 **caller 제공**(D7).
3. **선(先) TOCTOU 가드 점유(D11)**: `createSendingDelivery`를 **task-status 가드와 한 트랜잭션**으로 — 현재 status가 이 단계의 `fromStatus`(1단계=GENERATED, 2단계=SENT)이고 활성 SENDING이 없을 때만 SENDING 레코드 생성. CANCELLED/비-sendable이면 ConflictError. (foundation `createSendingDelivery`에 expected fromStatus 조건 추가 — foundation §13 후속 "cancel vs 동시 발송 TOCTOU" 이행.) 동시 중복은 `(taskId,step)` partial unique index가 DB 레벨 최종 방어선(foundation, 마이그레이션 `20260619120000`에 존재).
4. 첨부 상대→절대(**`resolveStoragePath` strict**) 후 SMTP 발송. **발송 직전~직후 내내 delivery는 SENDING 유지** → `hasActiveSending`이 이를 관측해 cancel을 계속 차단.
5. **후(後) 원자 확정(G2b)**: SMTP 성공 시 `finalizeDelivery(SENT)` + `transitionTask(targetStatus)`를 **한 DB 트랜잭션**으로 처리한다. SENDING이 이 tx 직전까지 유지되므로 "delivery=SENT인데 task 미전이"인 cancel 침투 창이 없다(메일 발송된 작업이 CANCELLED되는 것 차단). SMTP 실패 시 `finalizeDelivery(FAILED)`만, 전이 없음(발송 실패가 전이를 막지 않음). SMTP 성공 후 이 tx가 실패하면 **SENDING으로 남기고 에러 전파**(FAILED 둔갑 금지 — 중복 발송 방지, admin resolve, foundation §6.2·§6.3). `sentAt`은 SENT에서만 stamp.
   - 구현: foundation `deliver`를 **선택적 `onDeliveredTx`(finalize와 같은 tx에서 실행할 전이)** 를 받도록 확장하거나, send 오케스트레이션이 `createSendingDelivery`(guarded) + `sendMail` + `finalize+transition` 한 tx를 직접 조립한다. 기본(전이 없음) 동작은 불변 — leave 등 기존 소비자 영향 없음.

### 9.3 mail.ts 적응 (D8, 공유 코드) — F4 반영: legacy resolver는 첨부 전용

- `deliver`: `args.msg.attachments[].path`는 **절대경로**로 받아 SMTP에 사용하고, **DB 저장(`createSendingDelivery`)에는 `toStoredOutputPath(a.path)` 결과**를 넣는다 — `STORAGE_ROOT/out` 하위면 상대경로로 환원, 그 외 절대경로(leave 등)는 그대로 저장(하위호환).
- `retryDelivery`: 저장된 `attachmentPaths`를 **`resolveAttachmentPath`(legacy 허용)** 로 절대화한 뒤 `existsSync`·`sendMail`. 이미-절대경로는 통과(leave 하위호환). **이 legacy 통과는 다운로드 경계(`resolveStoragePath` strict)와 분리**돼 있어 절대경로 허용이 파일 다운로드로 새지 않는다(F4).
- **leave 발송 회귀 테스트**: leave 알림 메일(첨부 없음 `[]`)이 적응 후에도 그대로 통과함을 보장.

### 9.4 라우트

`POST /api/workflows/[id]/send` (일반). body: `{ step, subject, body }`, `step ∈ {1,2}`(zod enum, 3은 거부 — F2). 권한은 `runSend` 내부 kind별 게이트.

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
- mail 첨부 legacy 절대경로 통과 제거: cutover에서 leave 첨부를 상대경로로 정규화하면 `resolveAttachmentPath`의 절대 통과를 폐지(F4).
- 주간보고·알림톡 sub-project가 `GENERATORS` 레지스트리에 등록만으로 generate/send/download 라우트 재사용.
- 운영 cutover 시 과거 `BillingConfig`/`BillingRoundDate` 데이터 이전(Phase 6).
- AI 서명 없는 commit(글로벌 규칙).
