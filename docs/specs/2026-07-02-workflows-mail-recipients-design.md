# 워크플로 메일 수신자 세트(주소록 + 타입×단계 기본값) 설계

- Status: Draft (brainstorming 합의)
- Date: 2026-07-02
- 선행: **대금청구 백엔드/UI**(PR #28·#29 — send 1·2단계, `MailDelivery`, `effectiveRecipients`), **업무 캘린더**(PR #30), **설정 재설계 PR-A**(PR #25 — 설정 그룹 카드·死설정 제거 원칙).
- 배경: 대금청구 UI spec(2026-06-30)에서 **CC/BCC를 명시 유보**("백엔드 send가 수신자 단일 목록(To)만 받음")한 sub-project B. day-sync 선례 = 설정 모달에서 타입별 `{to, cc, bcc, hq:{to,cc,bcc}}` 기본 수신자 관리.
- 후속: 주간보고·알림톡청구·고객사 보고의 발송 단계 추가(각 생성기 sub-project), 발송 3단계(FINAL_SENT).

## 1. 목표와 범위

메일 발송 수신자를 **to/참조(cc)/숨은참조(bcc)** 로 확장하고, **업무유형×발송단계별 기본 수신자 세트**를 설정 화면에서 관리한다. 메일 주소가 늘어나도 누구인지 파악할 수 있도록 **주소록(이름·메모)** 을 중앙 관리한다(사용자 요구).

### 포함

- ① **메일 파이프라인 cc/bcc 지원** — `MailMessage`(lib) → `deliver`/`retryDelivery`(service) → `MailDelivery` 기록(additive 컬럼) → 상세 이력 표시
- ② **주소록 `MailContact`** — email(유니크) + 이름 + 메모, 관리 화면 CRUD
- ③ **타입×단계 기본 세트** — `WorkflowType.defaultRecipients` 구조화(`{ [step]: {to,cc,bcc} }`) + 관리 화면 편집
- ④ **설정 페이지 진입** — workflows 그룹 카드에 relational 항목 "메일 수신자" + 전용 관리 페이지
- ⑤ **발송 모달 확장** — 수신자/참조/숨은참조 3필드 + `{to,cc,bcc}` prefill + 주소록 이름 힌트
- ⑥ **권한 신설** — `workflows.mail:configure`(pm 부여, 기존 DB upgrade-once reconcile)
- ⑦ **死설정 정리** — `workflows.weeklyReport.defaultRecipients` catalog 항목·편집기 특례 제거, `workflows.billing.config`의 깨진 `manageHref` 수정
- ⑧ 단위·컴포넌트 테스트(vitest + testing-library)

### 비포함 (후속/범위 밖)

- **이름 있는 세트 선택**("고객사 A 담당자들" 드롭다운) — 사용자 결정(Q1): 타입×단계 기본값 방식만. 필요해지면 후속.
- **신규 발송 단계 추가** — `SEND_STEP_TRANSITION`은 불변(BILLING 1·2만). 주간보고 등은 각 생성기 sub-project에서.
- **leave 알림 메일의 cc/bcc 활용** — `MailMessage.cc/bcc`는 optional이라 기존 호출자 무변경. leave가 cc/bcc를 쓰는 것은 범위 밖.
- **수신 동의/발송 이력 열람 권한 변경** — 기존 게이트(`:send`·상세 view) 유지.

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | **세트 개념 = 타입×단계별 기본값**(day-sync 방식). 이름 있는 세트 선택 없음 | 사용자 결정(Q1). day-sync `{to,cc,bcc,hq}` 선례 계승, YAGNI |
| D2 | **주소록 = `MailContact` 테이블 신설**(workflows 스키마): `email` 유니크(소문자 정규화 저장) + `name` + `memo?`. 세트에는 **email 문자열만** 저장, 이름·메모는 UI가 주소록 조인 표시 | 사용자 결정(Q4): 같은 주소가 여러 세트에 들어가도 이름을 한 곳에서 수정(drift 없음). "주소가 늘어나면 누구인지 파악" 요구의 직접 구현 |
| D3 | **기본 세트 저장 = `WorkflowType.defaultRecipients` 구조 진화**: flat `string[]` → `{ [step: string]: {to: string[], cc: string[], bcc: string[]} }`. **현재 이 컬럼은 쓰기 지점이 없어 전부 null** → 데이터 마이그레이션 불필요, 코드 타입만 교체 | 도메인 데이터가 도메인 모델에 삶. kernel `SystemSetting` 병행 저장 시 이 컬럼이 死설정으로 남음(PR #25가 잡은 문제 재생산) → 단일 거처 |
| D4 | **`MailDelivery`에 additive `cc Json?`·`bcc Json?` 컬럼** 추가. 기존 `recipients` = **to 의미 보존** | 기존 행·소비자(`string[]` reader) 무변경. Json 재구조화(다형성)보다 additive가 명확 |
| D5 | **발송 해석 체인 개정(I1)**: 입력(모달 명시) → `type.defaultRecipients[step]` → 거부. **`task.recipients`는 체인에서 제거, 컬럼은 보존**. **to가 비면 거부**(cc/bcc만으론 발송 불가) | `task.recipients`는 쓰기 지점이 없는 死필드(항상 null) — 체인 유지 시 구조화 타입만 복잡해짐. 컬럼 drop은 비가역 마이그레이션이라 미채택(보존, 후속 정리) |
| D6 | **관리 API·페이지 게이트 = `admin.settings:configure` ∧ `workflows.mail:configure` 교집합**(읽기·쓰기 동일) | 사용자 결정(Q3). 연차 알림 토글(D6 선례: 설정페이지 게이트 + 도메인 게이트)과 대칭. kind별 `:configure` sprawl(3종 추가 필요) 회피 — 단일 신설 권한 |
| D7 | **편집 가능한 kind×step = `SEND_STEP_TRANSITION`(policy) 파생 단일 출처** — 현재 BILLING `"1"`·`"2"`만 노출·저장 허용, 그 외 kind/step은 400 | 발송이 정의되지 않은 kind의 세트는 소비처가 없는 死설정. 향후 kind에 발송 단계가 생기면 관리 화면이 자동 확장 |
| D8 | **`effectiveRecipients` 확장**: 상세 API는 step 컨텍스트가 없으므로 **단계별 맵** `{ [step]: {to,cc,bcc} }`을 내려주고, 각 항목은 서버측 주소록 조인으로 `{email, name?}` enrich. 모달이 자기 step 것을 prefill. 기존과 동일하게 **`:send` 권한자에게만**, 해당 수신자의 이름만 노출(주소록 전체 미노출) | 발송 모달에서도 "누구인지 파악" 충족하되 backend-minimal-data 원칙 준수(서버 조인, 필요분만) |
| D9 | **설정 진입 = catalog relational 항목**(`workflows.mail.recipients`, workflows 그룹, permission=`workflows.mail:configure`) + `manageHref: /admin/settings/mail-recipients` 전용 페이지 | 사용자 결정(Q2). 대금청구 설정(relational + manageHref)과 동일 패턴. 주소록 CRUD + 세트 편집은 인라인 편집기보다 전용 페이지가 적합 |
| D10 | **메일 정규화 규칙(sendMail 단일 관문)**: 필드별 trim·case-insensitive dedup(첫 표기 보존, 기존 로직 확장) + **cc − to, bcc − (to ∪ cc)** 교차 제외. `MailDelivery`는 호출자 입력 그대로 기록(현행과 대칭), 전송 시점에만 정규화 | 중복 수신 방지. 단일 관문이라 모든 호출자(workflows·leave)가 일관 |
| D11 | **권한 `workflows.mail:configure` 신설** — seed catalog·`RESOURCES` 추가, pm ALLOW. 기존 DB엔 **upgrade-once reconcile**(billing-create·client-kinds 선례 패턴, plan에서 헬퍼 확정) | 신설 권한은 fresh seed만으론 기존 설치에 미부여(캘린더 R3 학습). 접근제어 규칙①: 설정 카드 노출(useCan)과 API 게이트가 동일 키 |
| D12 | **주소록 미등록 email 허용** — 세트·발송 모두. 세트 편집 화면은 "주소록 미등록" 표시만, 주소록 삭제 시 세트 잔존 email도 유효 | 주소록은 식별 보조지 참조 무결성 대상이 아님. 강제 시 발송이 주소록 관리에 종속(운영 마찰) |
| D13 | **마이그레이션 = additive 2건**(`MailContact` 테이블, `MailDelivery` cc/bcc 컬럼) → **표준 restart 배포** | 컬럼 drop·재구조화 없음. 비가역 full-stop 불필요 |

## 3. 데이터 모델

```prisma
model MailContact {
  id        String   @id @default(cuid())
  email     String   @unique            // trim + 소문자 정규화 저장
  name      String                      // 예: "홍길동 (고객사 A 회계)"
  memo      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("workflows")
}
```

- `WorkflowType.defaultRecipients`(Json?, 기존 컬럼): `{ "1": {to,cc,bcc}, "2": {to,cc,bcc} }`. 관리 API가 zod로 형태 강제(D7의 step 키만). 저장 시 이메일 trim·소문자 정규화·필드별 dedup — 주소록 조인 매칭 일관.
- `MailDelivery`: `cc Json?`·`bcc Json?` 추가. null → 소비자는 `[]`로 해석(기존 행 호환).
- `WorkflowTask.recipients`: 불변(보존, 미사용 — D5).

## 4. 상세 설계

### 4.1 메일 lib (`src/lib/integrations/mail`)

- `MailMessage`에 `cc?: string[]; bcc?: string[]` 추가. `MailTransport.sendMail` opts에 `cc?/bcc?: string` 추가.
- `normalizeRecipients` 확장: to/cc/bcc 각각 정규화 + D10 교차 제외. **to는 비면 throw(기존), cc/bcc는 빈 결과 허용(헤더 생략)**.
- 기존 호출자(leave 알림 등)는 cc/bcc 미지정 → 동작 불변.

### 4.2 발송 경로 (workflows services)

- `runSend` 입력: `{step, subject, body, recipients(=to), cc?, bcc?}` — 기존 필드명 유지(surgical). 해석: 입력이 오면 **입력의 to/cc/bcc를 그대로**(D6 모달 명시 전송 원칙 유지), 없으면 `type.defaultRecipients[step]` 폴백(API 직접 호출 경로용), to 비면 `ConflictError`.
- `deliver`: `createSendingDelivery`에 cc/bcc 기록, `sendMail`에 전달.
- `retryDelivery`: 저장된 `recipients + cc + bcc`로 재발송(D4 컬럼 소비).
- `resolveDelivery`: 무변경(수신자 미관여).
- `MailView`(상세 이력): `cc: string[]; bcc: string[]` 추가(null→`[]`), UI에 참조/숨은참조 표시.
- `effectiveRecipients`(D8): `type.defaultRecipients`에서 파생한 단계별 맵 `{ [step]: { to: Array<{email, name?}>, cc: [...], bcc: [...] } }`. 모달이 자기 step 것을 prefill. 기존 flat `string[]` 필드는 이 구조로 대체(소비처 = 발송 모달뿐, 동시 교체).

### 4.3 관리 API (workflows routes, 게이트 = D6 교집합)

- `GET /api/workflows/mail/contacts` — 주소록 목록.
- `POST /api/workflows/mail/contacts` — `{email, name, memo?}`. email 정규화 후 유니크 충돌 409.
- `PATCH/DELETE /api/workflows/mail/contacts/[id]` — 수정(이름·메모·email)·삭제. 삭제는 세트 잔존과 무관(D12).
- `GET /api/workflows/mail/recipients` — kind별 세트 전체(D7 파생 kind×step만).
- `PUT /api/workflows/mail/recipients/[kind]` — `{ [step]: {to,cc,bcc} }` 전체 교체 저장. kind·step이 D7 파생 밖이면 400. 이메일 zod `.email()` 검증.

### 4.4 관리 페이지 (`/admin/settings/mail-recipients`, Aurora 컨벤션)

- 서버 게이트: 페이지 진입 시 D6 교집합 검사(불충족 redirect) — API와 동일 키(접근제어 규칙①).
- **주소록 섹션**: 테이블(email·이름·메모·수정/삭제) + 추가 모달.
- **기본 세트 섹션**: D7 파생 kind×step 카드(현재 "대금청구 1단계/2단계") — to/cc/bcc 쉼표 구분 입력, 저장. 각 이메일 옆에 주소록 이름 배지, 미등록이면 "주소록 미등록" 표시(D12).
- 설정 페이지 카드: catalog relational 항목으로 노출(D9) — permission에 따라 항목 자체가 숨겨짐(기존 listSettings 동작).

### 4.5 발송 모달 (`send-modal.tsx`)

- 수신자/참조/숨은참조 3필드(쉼표 구분). prefill = `effectiveRecipients[step]`(D8). 이메일 아래 이름 힌트 표시(enrich된 name).
- 제출: 화면 목록을 **항상 명시 전송**(`recipients`+`cc`+`bcc`, D6 원칙 유지). to 비면 클라 차단(기존 fail-closed 유지), cc/bcc는 빈 허용.

### 4.6 死설정 정리 (⑦)

- catalog에서 `workflows.weeklyReport.defaultRecipients` 항목 제거 + `settings-editor.tsx`의 email 특례(현재 223행) 제거. DB `kernel."SystemSetting"` 잔존 행은 catalog 기반 노출이라 무해 — 배포 preflight에서 값 확인(비어있지 않으면 수동 이관 판단).
- `workflows.billing.config`의 `manageHref` → `/workflows/billing/settings` 수정(+ 기존 테스트 기대값 갱신). 사용자 승인 완료.

## 5. 권한 (접근제어 규칙 ①②)

- 신설: `workflows.mail:configure`. seed: `RESOURCES`·permission catalog 추가, seed-roles **pm ALLOW**. 기존 DB: upgrade-once reconcile(D11, plan에서 헬퍼·순서 확정).
- 관리 UI 노출(설정 카드·페이지)과 관리 API가 **동일 키 교집합**(D6) — deny 우선·기본 거부 유지.
- `effectiveRecipients`·이력 cc/bcc 표시는 기존 게이트(`:send`·상세 view) 그대로.

## 6. 테스트

- **mail lib**: cc/bcc 전달, D10 정규화(필드별 dedup·교차 제외·표기 보존), to 빈 throw·cc/bcc 빈 허용, 기존 호출 형태(무 cc/bcc) 회귀.
- **deliver/retry**: cc/bcc 기록·재발송, 기존 행(cc/bcc null) 재시도 호환.
- **runSend**: 입력 우선·type[step] 폴백·task.recipients 미참조(D5)·to 빈 거부.
- **관리 API**: D6 교집합 게이트(둘 중 하나 결여 시 403), D7 밖 kind/step 400, email 검증·정규화·유니크 409.
- **effectiveRecipients**: `:send` 게이트 유지, 구조·enrich(주소록 조인, 미등록 name 없음).
- **UI**: 관리 페이지(주소록 CRUD·세트 편집·이름 배지), 발송 모달(3필드 prefill·명시 전송 payload·to 빈 차단).
- **회귀**: leave 알림 발송 무변경, 상세 이력 기존 행 표시.

## 7. 배포

표준 restart(D13): `prisma migrate deploy`(additive 2건) → `prisma:generate` → `db:seed`(신설 권한 catalog·pm grant·reconcile) → build → `pm2 restart`.

- preflight: `kernel."SystemSetting"`의 `workflows.weeklyReport.defaultRecipients` 값 확인(§4.6). multiSchema 주의 — 테이블 참조는 스키마 한정 필수.
- smoke: `/admin/settings/mail-recipients` 게이트(pm 200·비권한 redirect), `/api/workflows/mail/contacts` 401/403, 발송 모달 3필드 prefill, 기존 상세 이력 렌더.

## 8. 적대검증 ledger (spec 단계)

(review-loop에서 기록)
