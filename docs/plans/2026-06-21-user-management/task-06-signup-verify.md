# task-06 — 자가가입 · verify/set-password · D18 레이트리밋

> 공개(미인증) 계정 진입 3종 라우트(`signup`·`verify-email`·`resend-verification`)와 그 앞단의 D18 남용 통제(DB-backed `RateBucket` 원자적·사전 강제)·토큰 해시 유틸을 구현한다. 자가가입은 **비번 없이 PENDING**(C안), 비밀번호는 메일 수신자만 set-password 토큰으로 설정한다.

## Files

**Create**
- `src/modules/admin/users/rate-limit.ts` — **S10 공유 상수(`VERIFY_TOKEN_TTL_MS`/`SIGNUP_IP_LIMIT`/`SIGNUP_EMAIL_LIMIT`/`RESEND_COOLDOWN_MS`/`RATE_WINDOW_MS`/`PENDING_UNVERIFIED_CAP`) 정의·export** + D18 RateBucket **race-safe·사전 강제**(atomic conditional UPDATE + advisory lock) + per-IP/per-email + 재발송 쿨다운 + IP 추출 (상수·강제 유틸이 같은 파일. task-09 테스트도 여기서 import). `PENDING_UNVERIFIED_CAP` **상수는 여기(06)가 소유·export**하되, 그 **강제는 task-03 `createPendingSignup`가 트랜잭션 내**에서 수행한다(finding #3 — `enforcePendingCap` 없음). signup 라우트가 `createPendingSignup` 호출 시 이 상수를 `pendingCap` **인자로 주입**한다(deps 역전 방지 — 03은 이 상수를 import하지 않는다).
- `src/modules/admin/users/token.ts` — set-password 겸 검증 토큰 생성(평문)·sha256 해시 유틸
- `src/modules/admin/users/validations/signup.ts` — 공개 라우트 zod: `signupSchema`(비번 없음)·`setPasswordSchema`·`resendSchema`
- `src/modules/admin/users/mail-templates.ts` — `buildVerifyEmailMail(link)` (leave `mail-templates.ts` esc 패턴)
- `src/app/api/auth/signup/route.ts`
- `src/app/api/auth/verify-email/route.ts`
- `src/app/api/auth/resend-verification/route.ts`
- `src/app/api/auth/_shared.ts` — signup 계열 `mapAuthError`(S4 매핑: `RateLimitError`→429, `TokenError`/`UserValidationError`→400, `UserConflictError`→409)

**Test**
- `tests/modules/admin/users/rate-limit.test.ts`
- `tests/modules/admin/users/token.test.ts`
- `tests/app/auth-signup-route.test.ts`
- `tests/app/auth-verify-email-route.test.ts`
- `tests/app/auth-resend-route.test.ts`

> Modify: 없음(신규 파일만). S10 공유 상수는 `policy.ts`가 아니라 `rate-limit.ts`에 정의·export한다(엔트리포인트 §S10 단일 출처).

## Prep

읽기(맥락 확인용, 재인라인 금지 — entrypoint §Shared Contracts가 단일 진실원):

- entrypoint `docs/plans/2026-06-21-user-management.md` §S1(`RateBucket` 모델·`User.emailVerify*` 필드)·§S4(에러)·§S6(`createPendingSignup`/`setPasswordViaToken`/`refreshVerifyToken` 시그니처·반환 계약)·§S8(`UserMailEvent="VERIFY_EMAIL"`·`leaveRequestId=null`·`triggerLeaveMailDrain`)·§S10(상수·D18 강제 규약).
- spec `docs/specs/2026-06-21-user-management-account-admin-design.md` 섹션 5(자가신청 C안·이메일검증)·섹션 8(공개 라우트 표)·**D10**(중복 중립 거부·만료 PENDING 교체)·**D16**(이메일검증·set-password 토큰)·**D18**(공개 남용 통제).
- 패턴 참조(인라인됨, 재읽기 불필요):
  - `src/app/api/leave/requests/route.ts` — 라우트 핸들러 골격(`req.json()` try/catch → `safeParse` → `try { … } catch (e) { return mapError(e) }`).
  - `src/app/api/leave/_shared.ts` — `mapError` 패턴(에러 instanceof → status).
  - `prisma/seed.ts` L87 — bcrypt 해싱(`bcrypt.hashSync(pw, 10)`; 비동기는 `bcrypt.hash(pw, 10)`).
  - `src/modules/leave/mail-templates.ts` — HTML esc 패턴(저장형 인젝션 차단).
  - `src/lib/prisma/index.ts` — `prisma` 싱글톤·`PrismaTx`.

## Deps

- **01** (스키마·마이그레이션): `RateBucket` 모델, `User.emailVerifyTokenHash`/`emailVerifyExpiresAt`/`emailVerifiedAt`/`passwordHash?` 컬럼. (단위테스트는 prisma/repo를 모킹하므로 DB 없이 통과)
- **03** (repository): `createPendingSignup`/`setPasswordViaToken`/`refreshVerifyToken`(S6) + `triggerLeaveMailDrain`(공통 트리거, S8). 이 task는 repo 함수의 **호출·반환 계약만** 의존(전부 mock). **finding #4: `createPendingSignup`/`refreshVerifyToken`은 `mail: UserMailJob` 인자를 받아 User 생성/토큰갱신과 같은 트랜잭션에서 메일을 enqueue**하므로, 라우트는 메일 본문을 만들어 인자로 넘길 뿐 직접 `enqueueUserMail`을 호출하지 않는다(별도 enqueue 트랜잭션 없음).
  - **deps 방향: 06→03만**(task 테이블: 03=01,02 / 06=01,03). 03 `createPendingSignup`은 PENDING 상한을 `pendingCap: number` **인자로 주입받아** 트랜잭션 내에서 검사한다 — 03은 `rate-limit.ts` 상수에 의존하지 않는다(03→06 import 없음 → 순환·역전 없음). `PENDING_UNVERIFIED_CAP` 상수는 이 task(06)의 `rate-limit.ts`가 소유하고, signup 라우트가 `createPendingSignup` 호출 시 `pendingCap: PENDING_UNVERIFIED_CAP`로 주입한다(정상 방향 06→03).

> 06은 04에 의존하지 않는다(공개 라우트 검증 스키마는 04 validations index와 독립적으로 `validations/signup.ts`에 둔다 — entrypoint Task테이블의 "06·07은 03 이후 병렬 가능" 전제 충족).

## TDD steps

> 규칙: 매 스텝 — 실패 테스트 작성 → 실행(expect FAIL) → 최소 구현 → 실행(expect PASS) → commit. 모든 코드 스텝은 전체 코드 인라인. placeholder 금지.

### Step 1 — S10 공유 상수 (rate-limit.ts 신규 — 상수 블록 먼저)

S10 공유 상수는 `src/modules/admin/users/rate-limit.ts`에 정의·export한다(엔트리포인트 §S10 단일 출처 — `policy.ts` 아님). 이 파일은 Step 5에서 강제 유틸까지 채워지며, 본 스텝은 그 파일 상단 상수 블록을 먼저 만든다(상수·강제 함수가 같은 파일):

```ts
import "server-only";

// ── S10 공유 상수 (D16 토큰 만료 + D18 레이트리밋) ──
export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일 — set-password 겸 검증 토큰 만료(D16)
export const SIGNUP_IP_LIMIT = 10;            // per-IP 윈도우당 가입 시도
export const SIGNUP_EMAIL_LIMIT = 3;          // per-email 윈도우당 가입 시도
export const RESEND_COOLDOWN_MS = 60 * 1000;  // 재발송 쿨다운(per-email)
export const RATE_WINDOW_MS = 60 * 60 * 1000; // 레이트 윈도우 1시간
export const PENDING_UNVERIFIED_CAP = 200;    // 미처리 미검증 PENDING 전역 상한(bounded creation)
```

별도 실패 테스트 불필요(값 상수). Step 2 테스트가 import로 소비. Step 5에서 같은 파일에 강제 유틸(`extractClientIp`/`enforceRateLimit`/`enforceResendCooldown`)을 이어 작성한다. (`PENDING_UNVERIFIED_CAP` 상수는 여기 export하되 강제는 task-03 `createPendingSignup` 트랜잭션 안 — `enforcePendingCap` 함수는 두지 않는다, finding #3.)

### Step 2 — 토큰 유틸 (실패 테스트)

`tests/modules/admin/users/token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";

describe("token 유틸", () => {
  it("generateVerifyToken은 64-hex 평문 토큰을 만든다(randomBytes(32))", () => {
    const t = generateVerifyToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it("두 번 호출하면 서로 다른 토큰(엔트로피)", () => {
    expect(generateVerifyToken()).not.toBe(generateVerifyToken());
  });
  it("hashToken은 평문의 sha256 hex — DB엔 해시만 저장", () => {
    const plain = "deadbeef";
    expect(hashToken(plain)).toBe(createHash("sha256").update(plain).digest("hex"));
  });
  it("hashToken은 결정적(같은 입력 → 같은 해시)", () => {
    expect(hashToken("x")).toBe(hashToken("x"));
  });
});
```

```
npm test -- tests/modules/admin/users/token   # expect FAIL (모듈 미존재)
```

### Step 3 — 토큰 유틸 (최소 구현)

`src/modules/admin/users/token.ts`:

```ts
import "server-only";
import { randomBytes, createHash } from "node:crypto";

// 평문 토큰: 메일 링크에만 노출. DB엔 절대 평문을 저장하지 않는다(해시만).
export function generateVerifyToken(): string {
  return randomBytes(32).toString("hex");
}

// DB 저장·조회용 해시. sha256(평문) — 토큰 자체가 고엔트로피(256bit)라 솔트/스트레칭 불필요(비번 아님).
export function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}
```

```
npm test -- tests/modules/admin/users/token   # expect PASS
git add src/modules/admin/users/token.ts src/modules/admin/users/rate-limit.ts tests/modules/admin/users/token.test.ts
git commit -m "feat(user-mgmt): set-password 토큰 생성·sha256 해시 유틸 + S10 공유 상수(rate-limit.ts)(task-06)"
```

### Step 4 — D18 레이트리밋 유틸 (실패 테스트)

`tests/modules/admin/users/rate-limit.test.ts` — leave repositories.test.ts의 `vi.hoisted` fake-db 패턴. **finding #3: read-then-write 금지.** `enforceRateLimit`는 ① 윈도우 내 행을 **atomic conditional UPDATE**(`updateMany({where:{scope,key,windowStartedAt:{gt:now-window}}, data:{count:{increment:1}}})`)로 1차 증가하고, ② affected=0(신규/막만료)이면 **advisory lock**(`$executeRaw pg_advisory_xact_lock`) 직렬화 후 `upsert`로 `count=1`·`windowStartedAt=now` 리셋한다. fake `$transaction`은 cb에 fake db를 패스스루하고, `$executeRaw`/`$queryRaw`는 no-op mock.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = {
    rateBucket: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    user: { count: vi.fn() },
    $executeRaw: vi.fn(async () => 1),  // advisory lock no-op
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { extractClientIp, enforceRateLimit, enforceResendCooldown, SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, RATE_WINDOW_MS, RESEND_COOLDOWN_MS } from "@/modules/admin/users/rate-limit";
import { RateLimitError } from "@/modules/admin/users/errors";

beforeEach(() => vi.clearAllMocks());

describe("extractClientIp", () => {
  it("x-forwarded-for의 첫 IP(클라이언트)를 쓴다(프록시 체인 trim)", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(extractClientIp(req)).toBe("203.0.113.7");
  });
  it("헤더 없으면 'unknown'(차단 안 함·공유 버킷)", () => {
    expect(extractClientIp(new Request("http://x/"))).toBe("unknown");
  });
});

describe("enforceRateLimit (race-safe — atomic conditional UPDATE + advisory lock reset)", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  it("윈도우 내 기존 버킷: atomic conditional UPDATE로 increment, count<=limit이면 통과(읽기 없음)", async () => {
    // affected=1(윈도우 내 행 증가), 증가 후 count<=limit. updateMany는 affected만, count는 후속 read 없이 update 반환으로 판정.
    h.db.rateBucket.updateMany.mockResolvedValue({ count: 1 });          // affected rows = 1
    h.db.rateBucket.findUnique.mockResolvedValue({ count: 2, windowStartedAt: now }); // 증가 후 현재값(count<=limit)
    await expect(enforceRateLimit("signup:email", "a@x.com", SIGNUP_EMAIL_LIMIT, now)).resolves.toBeUndefined();
    // read-then-write 금지: 증가가 조건부 UPDATE로 먼저 일어난다(findUnique→upsert 순서 아님).
    expect(h.db.rateBucket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: "signup:email", key: "a@x.com", windowStartedAt: { gt: new Date(now.getTime() - RATE_WINDOW_MS) } }),
      data: { count: { increment: 1 } },
    }));
    expect(h.db.rateBucket.upsert).not.toHaveBeenCalled(); // 윈도우 내면 reset 경로 안 탐
  });
  it("윈도우 내 한도 초과면 RateLimitError(429) — atomic increment 결과가 limit 초과", async () => {
    h.db.rateBucket.updateMany.mockResolvedValue({ count: 1 });
    h.db.rateBucket.findUnique.mockResolvedValue({ count: SIGNUP_EMAIL_LIMIT + 1, windowStartedAt: now });
    await expect(enforceRateLimit("signup:email", "a@x.com", SIGNUP_EMAIL_LIMIT, now)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("신규/막만료(conditional UPDATE affected=0): advisory lock 후 upsert로 count=1 리셋·통과", async () => {
    h.db.rateBucket.updateMany.mockResolvedValue({ count: 0 });   // 윈도우 내 행 없음(신규 또는 만료)
    h.db.rateBucket.upsert.mockResolvedValue({ count: 1, windowStartedAt: now });
    await expect(enforceRateLimit("signup:ip", "203.0.113.7", SIGNUP_IP_LIMIT, now)).resolves.toBeUndefined();
    expect(h.db.$executeRaw).toHaveBeenCalled();                   // pg_advisory_xact_lock 직렬화
    expect(h.db.rateBucket.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ count: 1, windowStartedAt: now }),
      create: expect.objectContaining({ count: 1, windowStartedAt: now }),
    }));
  });
  it("리셋(count=1)은 limit>=1이면 통과(첫 시도가 곧바로 막히지 않음)", async () => {
    h.db.rateBucket.updateMany.mockResolvedValue({ count: 0 });
    h.db.rateBucket.upsert.mockResolvedValue({ count: 1, windowStartedAt: now });
    await expect(enforceRateLimit("signup:email", "fresh@x.com", SIGNUP_EMAIL_LIMIT, now)).resolves.toBeUndefined();
  });
  it("전 과정이 단일 $transaction 안에서(직렬화)", async () => {
    h.db.rateBucket.updateMany.mockResolvedValue({ count: 0 });
    h.db.rateBucket.upsert.mockResolvedValue({ count: 1, windowStartedAt: now });
    await enforceRateLimit("signup:ip", "1.2.3.4", SIGNUP_IP_LIMIT, now);
    expect(h.prisma.$transaction).toHaveBeenCalled();
  });
});

describe("enforceResendCooldown (per-email 쿨다운 — advisory lock 직렬화)", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  it("쿨다운 내 재발송이면 RateLimitError", async () => {
    h.db.rateBucket.findUnique.mockResolvedValue({ count: 1, updatedAt: new Date(now.getTime() - 1000) });
    await expect(enforceResendCooldown("a@x.com", now)).rejects.toBeInstanceOf(RateLimitError);
    expect(h.db.$executeRaw).toHaveBeenCalled(); // 조회·갱신 전 직렬화 락
  });
  it("쿨다운 경과면 통과하고 타임스탬프 갱신", async () => {
    h.db.rateBucket.findUnique.mockResolvedValue({ count: 1, updatedAt: new Date(now.getTime() - RESEND_COOLDOWN_MS - 1) });
    h.db.rateBucket.upsert.mockResolvedValue({});
    await expect(enforceResendCooldown("a@x.com", now)).resolves.toBeUndefined();
    expect(h.db.rateBucket.upsert).toHaveBeenCalled();
  });
  it("첫 발송(버킷 없음)이면 통과", async () => {
    h.db.rateBucket.findUnique.mockResolvedValue(null);
    h.db.rateBucket.upsert.mockResolvedValue({});
    await expect(enforceResendCooldown("a@x.com", now)).resolves.toBeUndefined();
  });
});
```

> `enforcePendingCap` 단위테스트는 이 파일에서 제거됐다. **PENDING 상한 검사는 task-03 `createPendingSignup`가 User 생성과 같은 트랜잭션에서 `tx.user.count`로 수행**한다(finding #3 — standalone count + 별도 생성 race 제거). 라우트는 `enforcePendingCap`을 호출하지 않는다. 상한 동작 검증은 task-03 `repositories.test.ts`의 "PENDING 상한 도달이면 RateLimitError" 케이스로 이동.

```
npm test -- tests/modules/admin/users/rate-limit   # expect FAIL (모듈 미존재)
```

### Step 5 — D18 레이트리밋 유틸 (최소 구현)

`src/modules/admin/users/rate-limit.ts`에 Step 1 상수 블록 **아래로 이어 작성**한다(상수·강제 유틸 동일 파일 — `./policy` import 없음). D18은 **원자적·사전(pre-write)·race-safe**: 버킷 증가가 한도를 넘으면 User/MailDelivery 생성 전에 `RateLimitError`. **finding #3: read-then-write 금지.** 윈도우 내 행은 **atomic conditional UPDATE**(`updateMany`의 `where`에 `windowStartedAt > now-window` 조건을 넣어 DB가 행 단위로 직렬화)로 증가하고, affected=0(신규/막만료)일 때만 **advisory lock**(`pg_advisory_xact_lock(hashtext(scope||key))`)으로 직렬화한 뒤 `upsert`로 `count=1` 리셋한다. 이렇게 하면 동시 첫-윈도우/막만료 요청이 모두 통과해 카운터를 1로 덮어쓰는 race가 사라진다.

```ts
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RateLimitError } from "./errors";

// ── S10 공유 상수 (Step 1에서 이 파일 상단에 정의함 — 동일 파일이라 재import 없음) ──
export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일 — set-password 겸 검증 토큰 만료(D16)
export const SIGNUP_IP_LIMIT = 10;            // per-IP 윈도우당 가입 시도
export const SIGNUP_EMAIL_LIMIT = 3;          // per-email 윈도우당 가입 시도
export const RESEND_COOLDOWN_MS = 60 * 1000;  // 재발송 쿨다운(per-email)
export const RATE_WINDOW_MS = 60 * 60 * 1000; // 레이트 윈도우 1시간
export const PENDING_UNVERIFIED_CAP = 200;    // 미처리 미검증 PENDING 전역 상한(bounded creation — task-03 createPendingSignup에서 트랜잭션 내 강제)

// IP는 x-forwarded-for의 첫 항목(클라이언트). 서버가 망 제한 뒤라 신뢰 가능(D1). 헤더 없으면 공유 'unknown' 버킷.
export function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown";
}

// 같은 트랜잭션을 (scope,key) 기준으로 직렬화. hashtext로 64비트 키 두 개를 만들어 충돌 영향을 줄인다. xact 락은 커밋/롤백 시 자동 해제.
async function advisoryLock(tx: Prisma.TransactionClient, scope: string, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${key}))`;
}

// 원자적·사전·race-safe 카운터. read-then-write 금지(finding #3):
//  ① 윈도우 내 행: where에 windowStartedAt>now-window를 넣은 atomic conditional UPDATE로 increment(DB가 행 단위 직렬화 → 동시 증가 안전).
//  ② affected=0(신규 또는 막 만료): advisory lock으로 (scope,key)를 직렬화한 뒤 upsert로 count=1·windowStartedAt=now 리셋
//     (락 보유자만 리셋하므로 동시 요청이 둘 다 count=1로 덮어쓰지 못함).
// 증가/리셋 후 현재 count>limit이면 거부. 전 과정을 단일 $transaction으로 묶어 advisory xact 락이 커밋까지 유지된다.
export async function enforceRateLimit(
  scope: string,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<void> {
  const windowFloor = new Date(now.getTime() - RATE_WINDOW_MS);
  const count = await prisma.$transaction(async (tx) => {
    // ① 윈도우 내 행을 조건부로 증가(만료/부재면 affected=0).
    const bumped = await tx.rateBucket.updateMany({
      where: { scope, key, windowStartedAt: { gt: windowFloor } },
      data: { count: { increment: 1 } },
    });
    if (bumped.count === 1) {
      const cur = await tx.rateBucket.findUnique({ where: { scope_key: { scope, key } }, select: { count: true } });
      return cur?.count ?? 1;
    }
    // ② 신규/막만료: 직렬화 후 리셋(새 윈도우 시작). 락은 같은 (scope,key) 동시요청을 줄세운다.
    await advisoryLock(tx, scope, key);
    const reset = await tx.rateBucket.upsert({
      where: { scope_key: { scope, key } },
      update: { count: 1, windowStartedAt: now },
      create: { scope, key, count: 1, windowStartedAt: now },
      select: { count: true },
    });
    return reset.count;
  });
  if (count > limit) throw new RateLimitError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
}

// per-email 재발송 쿨다운: 마지막 갱신(updatedAt)으로부터 RESEND_COOLDOWN_MS 이내 재발송 거부.
// advisory lock으로 (scope,email) 동시 재발송을 직렬화한 뒤 조회→갱신(race로 쿨다운을 동시 통과하는 것 방지).
export async function enforceResendCooldown(email: string, now: Date = new Date()): Promise<void> {
  const scope = "resend:email";
  await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, scope, email);
    const bucket = await tx.rateBucket.findUnique({ where: { scope_key: { scope, key: email } } });
    if (bucket && now.getTime() - bucket.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new RateLimitError("재발송은 잠시 후 다시 시도해 주세요.");
    }
    await tx.rateBucket.upsert({
      where: { scope_key: { scope, key: email } },
      update: { count: { increment: 1 }, windowStartedAt: now },
      create: { scope, key: email, count: 1, windowStartedAt: now },
    });
  });
}
```

> `enforcePendingCap`은 이 파일에서 제거됐다. **PENDING 전역 상한 검사는 task-03 `createPendingSignup`가 User 생성과 같은 트랜잭션에서 `tx.user.count`로 수행**한다(finding #3 — standalone count 후 별도 생성이 동시요청에 cap을 초과하던 race 제거). signup 라우트는 이 함수를 호출하지 않는다.
> `scope_key`는 `RateBucket`의 `@@unique([scope, key])` 복합 unique 입력 이름(S1). Prisma는 `where: { scope_key: { scope, key } }`로 노출한다. `bucket.updatedAt`은 `@updatedAt` 자동 필드(S1). conditional UPDATE는 복합 unique가 아니라 `(scope,key,windowStartedAt)` 필터라 `updateMany`를 쓴다(affected count로 분기).

```
npm test -- tests/modules/admin/users/rate-limit   # expect PASS
git add src/modules/admin/users/rate-limit.ts tests/modules/admin/users/rate-limit.test.ts
git commit -m "feat(user-mgmt): D18 레이트리밋 race-safe 강제(atomic conditional UPDATE + advisory lock·쿨다운)(task-06)"
```

### Step 6 — 공개 라우트 검증 스키마 (실패 테스트)

`tests/app/auth-signup-route.test.ts` 내에서 함께 검증해도 되지만, 스키마 자체는 단위로 둔다. `tests/modules/admin/users/signup-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signupSchema, setPasswordSchema, resendSchema } from "@/modules/admin/users/validations/signup";

describe("signupSchema (비번 없음)", () => {
  it("유효 입력 통과 — email·name·employmentType·jobFunction·department", () => {
    const r = signupSchema.safeParse({ email: "a@x.com", name: "홍길동", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: "개발팀" });
    expect(r.success).toBe(true);
  });
  it("password 필드는 받지 않는다(있어도 무시 — strip)", () => {
    const r = signupSchema.safeParse({ email: "a@x.com", name: "n", employmentType: "REGULAR", jobFunction: "PM", department: null, password: "should-be-ignored" });
    expect(r.success).toBe(true);
    expect("password" in (r as { data: object }).data).toBe(false);
  });
  it("잘못된 enum은 거부", () => {
    expect(signupSchema.safeParse({ email: "a@x.com", name: "n", employmentType: "X", jobFunction: "DEVELOPER", department: null }).success).toBe(false);
  });
  it("이메일 형식 아니면 거부", () => {
    expect(signupSchema.safeParse({ email: "not-email", name: "n", employmentType: "REGULAR", jobFunction: "PM", department: null }).success).toBe(false);
  });
});

describe("setPasswordSchema (token + 12자+)", () => {
  it("token·12자+ 통과", () => {
    expect(setPasswordSchema.safeParse({ token: "abc", password: "123456789012" }).success).toBe(true);
  });
  it("12자 미만 비번 거부", () => {
    expect(setPasswordSchema.safeParse({ token: "abc", password: "short" }).success).toBe(false);
  });
  it("token 누락 거부", () => {
    expect(setPasswordSchema.safeParse({ password: "123456789012" }).success).toBe(false);
  });
});

describe("resendSchema (email)", () => {
  it("이메일 통과", () => {
    expect(resendSchema.safeParse({ email: "a@x.com" }).success).toBe(true);
  });
});
```

```
npm test -- tests/modules/admin/users/signup-validation   # expect FAIL
```

### Step 7 — 공개 라우트 검증 스키마 (최소 구현)

`src/modules/admin/users/validations/signup.ts`. 비번 정책 12자+는 기존 시드 정책 재사용(S7). enum은 schema.prisma의 `EmploymentType`/`JobFunction`과 일치.

```ts
import { z } from "zod";

const employmentType = z.enum(["REGULAR", "CONTRACTOR"]);
const jobFunction = z.enum(["PM", "DEVELOPER", "CONTENT_MANAGER", "CIVIL_RESPONSE"]);

// 자가가입(C안): 비밀번호를 받지 않는다. password 키가 와도 strip(.strict 미사용 — 기본 strip).
export const signupSchema = z.object({
  email: z.string().email("이메일 형식이 아닙니다.").max(255),
  name: z.string().trim().min(1, "이름은 필수입니다.").max(100),
  employmentType,
  jobFunction,
  department: z.string().trim().max(100).nullish().transform((v) => v ?? null),
});

// set-password 겸 검증: 토큰 + 새 비밀번호(12자+ 정책 재사용).
export const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, "비밀번호는 12자 이상이어야 합니다."),
});

// 검증 메일 재발송: 이메일만.
export const resendSchema = z.object({
  email: z.string().email().max(255),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
```

```
npm test -- tests/modules/admin/users/signup-validation   # expect PASS
```

### Step 8 — 검증 메일 템플릿 (최소 구현, 테스트 없이 — 순수 함수)

`src/modules/admin/users/mail-templates.ts`. leave `mail-templates.ts`의 esc 패턴 재사용(저장형 HTML 인젝션 차단). 링크는 라우트가 만든 절대 URL을 받는다.

```ts
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

// 검증 겸 set-password 안내 메일(D16). link는 평문 토큰을 쿼리로 담은 절대 URL(라우트가 origin으로 생성).
export function buildVerifyEmailMail(link: string): { subject: string; bodyHtml: string } {
  return {
    subject: "[ops-hub] 이메일 인증 및 비밀번호 설정",
    bodyHtml:
      `<p>ops-hub 가입 신청이 접수되었습니다.</p>` +
      `<p>아래 링크에서 이메일을 인증하고 비밀번호를 설정해 주세요(7일 내 유효).</p>` +
      `<p><a href="${esc(link)}">이메일 인증 및 비밀번호 설정</a></p>` +
      `<p>설정 완료 후 관리자 승인을 거쳐야 로그인할 수 있습니다.</p>`,
  };
}
```

(커밋은 Step 9/10/11 라우트와 함께 — 템플릿/스키마/유틸을 한 커밋에 묶는다.)

### Step 9 — `POST /api/auth/signup` (실패 테스트 → 구현)

`tests/app/auth-signup-route.test.ts` — leave route 테스트 패턴(`vi.mock` repo/rate-limit/token/mail). **핵심 단언: 한도 초과 시 createPendingSignup·triggerLeaveMailDrain 미호출 + 429.** finding #4: 라우트는 메일을 `createPendingSignup`의 `mail` 인자로 넘긴다(별도 enqueue 트랜잭션 없음) — 메일 본문(`buildVerifyEmailMail`)을 만들어 인자로 전달함을 단언.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(), extractClientIp: vi.fn(() => "1.2.3.4"),
  createPendingSignup: vi.fn(), triggerLeaveMailDrain: vi.fn(),
  generateVerifyToken: vi.fn(() => "plain-token"), hashToken: vi.fn((t: string) => `hash:${t}`),
  buildVerifyEmailMail: vi.fn((link: string) => ({ subject: "verify", bodyHtml: `<a href="${link}">link</a>` })),
}));

vi.mock("@/modules/admin/users/rate-limit", () => ({
  enforceRateLimit: m.enforceRateLimit, extractClientIp: m.extractClientIp,
  PENDING_UNVERIFIED_CAP: 200, // 라우트가 createPendingSignup에 pendingCap으로 주입하는 상수
}));
vi.mock("@/modules/admin/users/repositories", () => ({ createPendingSignup: m.createPendingSignup }));
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: m.triggerLeaveMailDrain }));
vi.mock("@/modules/admin/users/token", () => ({ generateVerifyToken: m.generateVerifyToken, hashToken: m.hashToken }));
vi.mock("@/modules/admin/users/mail-templates", () => ({ buildVerifyEmailMail: m.buildVerifyEmailMail }));
vi.mock("@/modules/admin/users/errors", async () => {
  class RateLimitError extends Error {}
  class UserConflictError extends Error {}
  class TokenError extends Error {}
  class UserValidationError extends Error {}
  return { RateLimitError, UserConflictError, TokenError, UserValidationError };
});

import { POST } from "@/app/api/auth/signup/route";

const body = (b: object) => new Request("http://localhost/api/auth/signup", {
  method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
});
const valid = { email: "self@x.com", name: "자가", employmentType: "REGULAR", jobFunction: "DEVELOPER", department: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.extractClientIp.mockReturnValue("1.2.3.4");
});

describe("POST /api/auth/signup", () => {
  it("정상: PENDING+메일 원자 생성 위임 + drain 트리거 + 중립 202 (mail 인자 전달)", async () => {
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockResolvedValue({ id: "u-self" });
    const res = await POST(body(valid));
    expect([200, 202]).toContain(res.status);
    // 라우트는 user+mail을 한 번의 createPendingSignup 호출로 위임한다(별도 enqueue 트랜잭션 없음 — finding #4).
    // PENDING 상한 상수를 pendingCap 인자로 주입한다(deps 역전 방지 — repository는 rate-limit.ts를 import하지 않음).
    expect(m.createPendingSignup).toHaveBeenCalledWith(expect.objectContaining({
      email: "self@x.com", tokenHash: "hash:plain-token", pendingCap: 200,
      mail: expect.objectContaining({ recipients: ["self@x.com"], subject: "verify" }),
    }));
    expect(m.triggerLeaveMailDrain).toHaveBeenCalled();
  });

  it("D18 한도 초과: createPendingSignup·drain 미호출 + 429 (pre-write)", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("too many"));
    const res = await POST(body(valid));
    expect(res.status).toBe(429);
    expect(m.createPendingSignup).not.toHaveBeenCalled();
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("PENDING 상한 초과(createPendingSignup가 트랜잭션 내 RateLimitError): drain 미호출 + 429", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockRejectedValueOnce(new RateLimitError("cap"));
    const res = await POST(body(valid));
    expect(res.status).toBe(429); // RateLimitError는 중립 흡수 대상 아님 — mapAuthError로 429
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("중복 이메일(UserConflictError): 중립 202(열거 방지) — drain은 미호출", async () => {
    const { UserConflictError } = await import("@/modules/admin/users/errors");
    m.enforceRateLimit.mockResolvedValue(undefined);
    m.createPendingSignup.mockRejectedValueOnce(new UserConflictError("dup"));
    const res = await POST(body(valid));
    expect([200, 202]).toContain(res.status); // 409를 그대로 노출하지 않는다(D10 중립 메시지)
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });

  it("zod 실패(잘못된 enum)는 400", async () => {
    const res = await POST(body({ ...valid, employmentType: "X" }));
    expect(res.status).toBe(400);
    expect(m.enforceRateLimit).not.toHaveBeenCalled();
  });

  it("잘못된 JSON은 400", async () => {
    const res = await POST(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } }));
    expect(res.status).toBe(400);
  });
});
```

```
npm test -- tests/app/auth-signup-route   # expect FAIL
```

`src/app/api/auth/_shared.ts` (signup 계열 에러 매핑, S4):

```ts
import { NextResponse } from "next/server";
import { RateLimitError, TokenError, UserConflictError, UserValidationError } from "@/modules/admin/users/errors";

// 공개 auth 라우트 에러 매핑(S4). 알 수 없는 에러는 재throw(500은 Next가 처리).
export function mapAuthError(error: unknown): NextResponse {
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
  if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof UserValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
```

`src/app/api/auth/signup/route.ts`. D18 사전 강제(per-IP·per-email) → 토큰 생성 → 검증 메일 본문 생성 → `createPendingSignup`(**User + 메일 enqueue + PENDING 상한 검사를 한 트랜잭션에서 원자 처리**) → drain. **finding #4: 라우트는 메일을 별도 트랜잭션으로 enqueue하지 않는다** — 메일 본문을 만들어 `createPendingSignup`의 `mail` 인자로 넘기고, repository가 같은 트랜잭션에서 enqueue한다(부분실패로 메일 없는 PENDING이 생기지 않음). **중복(UserConflictError)만 중립 응답으로 흡수**(이메일 열거 방지, D10) — `RateLimitError`(IP/email/PENDING 상한)는 흡수하지 말고 `mapAuthError`로 429.

```ts
import { NextResponse } from "next/server";
import { signupSchema } from "@/modules/admin/users/validations/signup";
import { extractClientIp, enforceRateLimit, SIGNUP_IP_LIMIT, SIGNUP_EMAIL_LIMIT, VERIFY_TOKEN_TTL_MS, PENDING_UNVERIFIED_CAP } from "@/modules/admin/users/rate-limit";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";
import { createPendingSignup } from "@/modules/admin/users/repositories";
import { buildVerifyEmailMail } from "@/modules/admin/users/mail-templates";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { UserConflictError } from "@/modules/admin/users/errors";
import { mapAuthError } from "../_shared";

// 신청 접수 여부를 항상 동일 메시지로 응답 — 이메일 존재 여부가 새지 않게(D10·D18 열거 방지).
const ACCEPTED = { message: "가입 신청이 접수되었습니다. 이메일을 확인해 주세요." };

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const input = parsed.data;
  const email = input.email.toLowerCase();

  try {
    // ── D18 사전 강제(원자적·pre-write): per-IP·per-email 한도 초과 시 User/MailDelivery 행 생성 전 429 ──
    //    (PENDING 전역 상한은 createPendingSignup 트랜잭션 안에서 검사 — 동시요청 cap 초과 방지, finding #3)
    const ip = extractClientIp(req);
    const now = new Date();
    await enforceRateLimit("signup:ip", ip, SIGNUP_IP_LIMIT, now);
    await enforceRateLimit("signup:email", email, SIGNUP_EMAIL_LIMIT, now);

    // 토큰: 평문은 메일 링크에만, DB엔 해시. 검증 메일 본문도 미리 만들어 repository에 넘긴다(같은 트랜잭션에서 enqueue).
    const plainToken = generateVerifyToken();
    const tokenHash = hashToken(plainToken);
    const tokenExpiresAt = new Date(now.getTime() + VERIFY_TOKEN_TTL_MS);
    const origin = new URL(req.url).origin;
    const link = `${origin}/verify-email?token=${plainToken}`;
    const { subject, bodyHtml } = buildVerifyEmailMail(link);

    try {
      // User 생성·만료 PENDING 교체·검증메일 enqueue·PENDING 상한 검사를 createPendingSignup이 한 트랜잭션에서 원자 처리(finding #3·#4).
      // PENDING 상한 상수는 라우트가 pendingCap 인자로 주입한다(deps 역전 방지 — repository는 rate-limit.ts를 import하지 않음).
      await createPendingSignup({
        email, name: input.name, employmentType: input.employmentType,
        jobFunction: input.jobFunction, department: input.department, tokenHash, tokenExpiresAt,
        mail: { recipients: [email], subject, bodyHtml }, pendingCap: PENDING_UNVERIFIED_CAP,
      });
    } catch (e) {
      // 중복(검증완료·활성·REJECTED·미만료 PENDING) → 열거 방지를 위해 동일 중립 응답(메일·drain 없이).
      // RateLimitError(PENDING 상한)는 여기서 흡수하지 않고 바깥 catch → mapAuthError(429)로.
      if (e instanceof UserConflictError) return NextResponse.json(ACCEPTED, { status: 202 });
      throw e;
    }

    // 메일은 트랜잭션 내에서 이미 enqueue됨 — 커밋 후 발송 트리거만(fire-and-forget).
    triggerLeaveMailDrain();
    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (error) {
    return mapAuthError(error);
  }
}
```

```
npm test -- tests/app/auth-signup-route   # expect PASS
```

### Step 10 — `GET/POST /api/auth/verify-email` (실패 테스트 → 구현)

`tests/app/auth-verify-email-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  setPasswordViaToken: vi.fn(), hashToken: vi.fn((t: string) => `hash:${t}`),
  userFindFirst: vi.fn(), hash: vi.fn(async () => "bcrypt-hash"),
}));
vi.mock("@/modules/admin/users/repositories", () => ({ setPasswordViaToken: m.setPasswordViaToken }));
vi.mock("@/modules/admin/users/token", () => ({ hashToken: m.hashToken }));
vi.mock("bcryptjs", () => ({ default: { hash: m.hash } }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: m.userFindFirst } } }));

import { GET, POST } from "@/app/api/auth/verify-email/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/verify-email (토큰 유효성)", () => {
  it("유효(미만료) 토큰이면 200 valid", async () => {
    m.userFindFirst.mockResolvedValue({ id: "u1", emailVerifyExpiresAt: new Date(Date.now() + 100000) });
    const res = await GET(new Request("http://x/api/auth/verify-email?token=abc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: true });
  });
  it("만료/위조 토큰이면 400", async () => {
    m.userFindFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/auth/verify-email?token=bad"));
    expect(res.status).toBe(400);
  });
  it("token 쿼리 없으면 400", async () => {
    const res = await GET(new Request("http://x/api/auth/verify-email"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/verify-email (set-password)", () => {
  it("유효 토큰 + 12자+ → passwordHash·emailVerifiedAt 설정(setPasswordViaToken) 200", async () => {
    m.setPasswordViaToken.mockResolvedValue({ id: "u1" });
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "abc", password: "123456789012" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(m.hash).toHaveBeenCalledWith("123456789012", 10); // bcrypt cost 10(seed와 동일)
    expect(m.setPasswordViaToken).toHaveBeenCalledWith("hash:abc", "bcrypt-hash", expect.any(Date));
  });
  it("만료/위조 토큰(setPasswordViaToken null) → 400", async () => {
    m.setPasswordViaToken.mockResolvedValue(null);
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "bad", password: "123456789012" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(400);
  });
  it("12자 미만 비번 → 400(zod), setPasswordViaToken 미호출", async () => {
    const res = await POST(new Request("http://x/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token: "abc", password: "short" }), headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(400);
    expect(m.setPasswordViaToken).not.toHaveBeenCalled();
  });
});
```

```
npm test -- tests/app/auth-verify-email-route   # expect FAIL
```

`src/app/api/auth/verify-email/route.ts`. GET=토큰 유효성(만료 검사). POST=토큰 해시로 set-password(비번 bcrypt cost 10). `setPasswordViaToken` 반환 null이면 `TokenError`(400).

```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setPasswordSchema } from "@/modules/admin/users/validations/signup";
import { hashToken } from "@/modules/admin/users/token";
import { setPasswordViaToken } from "@/modules/admin/users/repositories";
import { TokenError } from "@/modules/admin/users/errors";
import { mapAuthError } from "../_shared";

// GET: 폼 렌더 전 토큰 유효성 확인(만료·존재). 해시로 조회 — 평문 토큰을 DB와 직접 비교하지 않는다.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "유효하지 않거나 만료된 링크입니다." }, { status: 400 });
  return NextResponse.json({ valid: true }, { headers: { "Cache-Control": "no-store" } });
}

// POST: 토큰+새 비번 → passwordHash(bcrypt 10)+emailVerifiedAt 기록(setPasswordViaToken). PENDING 유지(승인 전 로그인 불가).
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = setPasswordSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const tokenHash = hashToken(parsed.data.token);
    const passwordHash = await bcrypt.hash(parsed.data.password, 10); // seed.ts와 동일 cost
    const result = await setPasswordViaToken(tokenHash, passwordHash, new Date());
    if (!result) throw new TokenError("유효하지 않거나 만료된 링크입니다.");
    return NextResponse.json({ message: "비밀번호가 설정되었습니다. 관리자 승인 후 로그인할 수 있습니다." });
  } catch (error) {
    return mapAuthError(error);
  }
}
```

```
npm test -- tests/app/auth-verify-email-route   # expect PASS
```

### Step 11 — `POST /api/auth/resend-verification` (실패 테스트 → 구현)

`tests/app/auth-resend-route.test.ts`. **열거 방지: 존재 여부 무관 중립 응답.** 쿨다운 위반은 429.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  enforceResendCooldown: vi.fn(), refreshVerifyToken: vi.fn(),
  triggerLeaveMailDrain: vi.fn(), generateVerifyToken: vi.fn(() => "plain"), hashToken: vi.fn((t: string) => `hash:${t}`),
  buildVerifyEmailMail: vi.fn((link: string) => ({ subject: "verify", bodyHtml: `<a href="${link}">link</a>` })),
}));
vi.mock("@/modules/admin/users/rate-limit", () => ({ enforceResendCooldown: m.enforceResendCooldown }));
vi.mock("@/modules/admin/users/repositories", () => ({ refreshVerifyToken: m.refreshVerifyToken }));
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: m.triggerLeaveMailDrain }));
vi.mock("@/modules/admin/users/token", () => ({ generateVerifyToken: m.generateVerifyToken, hashToken: m.hashToken }));
vi.mock("@/modules/admin/users/mail-templates", () => ({ buildVerifyEmailMail: m.buildVerifyEmailMail }));
vi.mock("@/modules/admin/users/errors", () => ({ RateLimitError: class extends Error {}, TokenError: class extends Error {}, UserConflictError: class extends Error {}, UserValidationError: class extends Error {} }));

import { POST } from "@/app/api/auth/resend-verification/route";

const req = (b: object) => new Request("http://localhost/api/auth/resend-verification", {
  method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" },
});

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/auth/resend-verification", () => {
  it("미검증 PENDING 존재: 토큰갱신+메일 재enqueue를 refreshVerifyToken에 위임 + drain + 중립 202 (mail 인자 전달)", async () => {
    m.enforceResendCooldown.mockResolvedValue(undefined);
    m.refreshVerifyToken.mockResolvedValue({ id: "u1" });
    const res = await POST(req({ email: "a@x.com" }));
    expect([200, 202]).toContain(res.status);
    // 라우트는 mail 본문을 만들어 refreshVerifyToken에 넘긴다(별도 enqueue 트랜잭션 없음 — finding #4).
    expect(m.refreshVerifyToken).toHaveBeenCalledWith("a@x.com", "hash:plain", expect.any(Date), expect.objectContaining({ recipients: ["a@x.com"], subject: "verify" }));
    expect(m.triggerLeaveMailDrain).toHaveBeenCalled();
  });
  it("존재하지 않는 이메일(refreshVerifyToken null): 동일 중립 응답·drain 미호출(열거 방지)", async () => {
    m.enforceResendCooldown.mockResolvedValue(undefined);
    m.refreshVerifyToken.mockResolvedValue(null);
    const res = await POST(req({ email: "ghost@x.com" }));
    expect([200, 202]).toContain(res.status);
    expect(m.triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
  it("쿨다운 위반: 429, refreshVerifyToken 미호출", async () => {
    const { RateLimitError } = await import("@/modules/admin/users/errors");
    m.enforceResendCooldown.mockRejectedValueOnce(new RateLimitError("cooldown"));
    const res = await POST(req({ email: "a@x.com" }));
    expect(res.status).toBe(429);
    expect(m.refreshVerifyToken).not.toHaveBeenCalled();
  });
  it("이메일 형식 아니면 400", async () => {
    const res = await POST(req({ email: "nope" }));
    expect(res.status).toBe(400);
  });
});
```

```
npm test -- tests/app/auth-resend-route   # expect FAIL
```

`src/app/api/auth/resend-verification/route.ts`. 쿨다운(사전) → 메일 본문 생성 → `refreshVerifyToken`(미검증 PENDING만 매칭·토큰갱신·메일 재enqueue를 한 트랜잭션에서, 없으면 null) → 있으면 drain. 존재 여부와 무관하게 동일 중립 응답. **finding #4: 라우트는 메일을 별도 트랜잭션으로 enqueue하지 않는다** — 본문을 만들어 `refreshVerifyToken`의 `mail` 인자로 넘기고, repository가 토큰 갱신과 같은 트랜잭션에서 enqueue한다.

```ts
import { NextResponse } from "next/server";
import { resendSchema } from "@/modules/admin/users/validations/signup";
import { enforceResendCooldown, VERIFY_TOKEN_TTL_MS } from "@/modules/admin/users/rate-limit";
import { generateVerifyToken, hashToken } from "@/modules/admin/users/token";
import { refreshVerifyToken } from "@/modules/admin/users/repositories";
import { buildVerifyEmailMail } from "@/modules/admin/users/mail-templates";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { mapAuthError } from "../_shared";

const ACCEPTED = { message: "해당 이메일로 인증 메일을 재발송했습니다(가입 신청이 있는 경우)." };

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = resendSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  try {
    const now = new Date();
    await enforceResendCooldown(email, now); // 쿨다운 위반은 429(사전)

    const plainToken = generateVerifyToken();
    const tokenHash = hashToken(plainToken);
    const tokenExpiresAt = new Date(now.getTime() + VERIFY_TOKEN_TTL_MS);
    const origin = new URL(req.url).origin;
    const link = `${origin}/verify-email?token=${plainToken}`;
    const { subject, bodyHtml } = buildVerifyEmailMail(link);

    // 미검증 PENDING만 토큰 갱신 + 검증메일 재enqueue(repository가 같은 트랜잭션에서 원자 처리).
    // 대상 없으면 null → 메일·drain 없이 동일 중립 응답(열거 방지).
    const target = await refreshVerifyToken(email, tokenHash, tokenExpiresAt, { recipients: [email], subject, bodyHtml });
    if (target) triggerLeaveMailDrain();
    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (error) {
    return mapAuthError(error);
  }
}
```

```
npm test -- tests/app/auth-resend-route   # expect PASS
```

### Step 12 — 통합 검증 + 커밋

```
npm test -- tests/modules/admin/users/token tests/modules/admin/users/rate-limit tests/modules/admin/users/signup-validation tests/app/auth-signup-route tests/app/auth-verify-email-route tests/app/auth-resend-route
npm run typecheck
npm run lint
git add src/modules/admin/users/validations/signup.ts src/modules/admin/users/mail-templates.ts src/app/api/auth/_shared.ts src/app/api/auth/signup src/app/api/auth/verify-email src/app/api/auth/resend-verification tests/modules/admin/users/signup-validation.test.ts tests/app/auth-signup-route.test.ts tests/app/auth-verify-email-route.test.ts tests/app/auth-resend-route.test.ts
git commit -m "feat(user-mgmt): 자가가입·verify/set-password·resend 공개 라우트 + D18 사전 강제(C안·D10·D16·D18)(task-06)"
```

## Acceptance Criteria

- `npm test -- tests/modules/admin/users/token` → PASS (`generateVerifyToken` 64-hex·`hashToken` sha256).
- `npm test -- tests/modules/admin/users/rate-limit` → PASS (atomic conditional UPDATE 증가·advisory lock 리셋·한도 초과 429·쿨다운). **race-safe: read-then-write(findUnique→upsert) 순서가 아니라 conditional UPDATE 우선 → affected=0일 때만 lock+reset.**
- `npm test -- tests/modules/admin/users/signup-validation` → PASS (비번 없는 signupSchema·12자+ setPasswordSchema).
- `npm test -- tests/app/auth-signup-route` → PASS. 특히 **per-IP/email 한도 초과 시 `createPendingSignup`·`triggerLeaveMailDrain` 미호출·429**, **PENDING 상한 초과 시(createPendingSignup이 트랜잭션 내 `RateLimitError`) drain 미호출·429**, 정상 시 **`createPendingSignup`에 `mail` 인자가 전달**됨(별도 enqueue 트랜잭션 없음). PENDING 상한 강제 자체의 단위검증은 task-03 `repositories.test.ts`.
- `npm test -- tests/app/auth-verify-email-route` → PASS (GET 유효성·POST set-password·만료/위조 400·`bcrypt.hash(pw, 10)`).
- `npm test -- tests/app/auth-resend-route` → PASS (존재/부재 동일 중립 응답·쿨다운 429).
- `npm run typecheck` → 그린(에러 0).
- `npm run lint` → 그린(`src/app/api/auth/*` 라우트 → `src/modules/admin/users/*` import는 boundaries 허용 — leave 라우트가 leave 모듈을 부르는 것과 동형).
- `npm test` 전체 → PASS (기존 leave/회귀 없음).

## Cautions

- **Don't 레이트리밋·상한을 행 생성 '뒤'에 검사하지 마라(pre-write 필수).** Reason: D18은 **원자적·사전** — `enforceRateLimit`(per-IP·per-email)를 `createPendingSignup` **전에** 호출해, 한도 초과면 User·MailDelivery 행이 한 줄도 안 생기고 429. `PENDING_UNVERIFIED_CAP`은 `createPendingSignup`이 **User 생성과 같은 트랜잭션 안에서** 검사한다(standalone count + 별도 생성 race 제거, finding #3) — 라우트에 `enforcePendingCap` 호출을 두지 마라(존재하지 않는다). signup-route 테스트의 `not.toHaveBeenCalled()`가 회귀 가드다. resend도 `enforceResendCooldown`을 `refreshVerifyToken` 전에.
- **Don't `PENDING_UNVERIFIED_CAP`을 task-03이 import하게 두지 마라(deps 역전 방지).** Reason: 상한 상수는 이 task(06)의 `rate-limit.ts`가 소유한다 — repository(03)가 이 상수를 import하면 03→06 의존이 생겨 task 테이블 deps(03=01,02 / 06=01,03)와 역전·순환이 된다. 대신 signup 라우트가 `createPendingSignup({ …, pendingCap: PENDING_UNVERIFIED_CAP })`로 상수를 인자 주입하고, repository는 `pendingCap: number`를 받아 트랜잭션 내에서 비교한다(정상 방향 06→03). signup-route 테스트의 `pendingCap: 200` 단언이 주입 가드다.
- **Don't User와 검증메일을 서로 다른 트랜잭션으로 쪼개지 마라(finding #4).** Reason: 라우트가 PENDING User를 만들고 메일을 **별도 트랜잭션**으로 enqueue하면, 둘째가 실패할 때 메일 없는 PENDING이 남고 재시도는 중복으로 막혀 신청자가 토큰 만료까지 갇힌다. 메일 본문을 만들어 `createPendingSignup`/`refreshVerifyToken`의 `mail` 인자로 넘기고, **repository가 User 생성/토큰갱신과 같은 트랜잭션에서 enqueue**한다(둘 다 커밋 or 둘 다 롤백). 라우트에서 `prisma.$transaction`으로 직접 `enqueueUserMail`을 호출하지 마라.
- **Don't 이메일 존재 여부를 노출하지 마라(열거 방지).** Reason: signup 중복(`UserConflictError`)·resend 부재(`refreshVerifyToken` null)는 **둘 다 동일 중립 202**로 흡수한다(409/404를 그대로 노출 금지, D10·D18). verify-email의 만료/위조만 명시적 400(토큰 자체가 비밀이라 열거 위험 없음).
- **Don't 평문 토큰을 DB에 저장하거나 평문으로 조회하지 마라.** Reason: 생성 평문(`randomBytes(32).hex`)은 **메일 링크에만**, DB·조회는 `hashToken`(sha256)로. GET/POST 모두 `hashToken(token)`으로 매칭한다. 토큰 유출 시 DB 해시로 역산 불가.
- **Don't 비번 해싱 cost를 바꾸지 마라.** Reason: set-password는 `bcrypt.hash(pw, 10)` — seed.ts(`bcrypt.hashSync(pw, 10)`)·authorize(`bcrypt.compare`)와 동일 cost 10. 다른 cost는 검증 일관성을 깨지 않지만 정책 통일을 위해 10 고정.
- **Don't repository를 우회해 직접 prisma로 User나 검증메일을 쓰지 마라.** Reason: User 생성·토큰 소비·갱신·검증메일 enqueue는 S6 repository 함수(`createPendingSignup`/`setPasswordViaToken`/`refreshVerifyToken`)만 수행한다(만료 PENDING 교체·status-CAS·원자적 토큰 매칭·메일 원자 enqueue가 거기 캡슐화됨, finding #4). **라우트의 직접 prisma 쓰기는 없다** — `RateBucket`은 `rate-limit.ts`의 `enforce*` 안에서만, GET 토큰 유효성 조회만 라우트의 직접 prisma read로 허용.
- **Don't `setPasswordViaToken`/`refreshVerifyToken` null을 예외로 던지지 마라(POST verify는 예외).** Reason: 두 repo 함수는 만료/부재 시 `null`을 반환한다(S6 계약). resend는 null이면 **조용히 중립 응답**(열거 방지), verify-email POST는 null을 `TokenError`로 승격해 400(사용자가 자기 토큰을 직접 들고 온 경로라 명시적 실패가 맞다).
- **Don't 이메일을 대소문자 구분해 처리하지 마라.** Reason: 레이트리밋 키·repo 호출에 `email.toLowerCase()`를 일관 사용(S10은 "email(소문자)"). signup·resend 모두 소문자화 후 사용. (signupSchema는 형식만 검증, 소문자화는 라우트에서.)
- **Don't `RateBucket` 동시 증가를 단순 read-then-write(findUnique→upsert)로 하지 마라(finding #3).** Reason: 동시 첫-윈도우/막만료 요청이 모두 "버킷 없음/만료"를 관측하고 카운터를 1로 덮어써 한도를 넘겨 통과한다. `enforceRateLimit`는 ① 윈도우 내 행을 **atomic conditional UPDATE**(`updateMany` where에 `windowStartedAt > now-window` — DB가 행 단위 직렬화)로 먼저 증가하고, ② affected=0(신규/막만료)일 때만 **advisory lock(`pg_advisory_xact_lock(hashtext(scope), hashtext(key))`)** 으로 직렬화한 뒤 `upsert`로 `count=1` 리셋한다. `enforceResendCooldown`도 같은 advisory lock으로 조회→갱신을 직렬화. 전 과정을 단일 `$transaction`으로 묶어 xact 락이 커밋까지 유지된다. DB-backed라 다중 인스턴스에서도 안전(S10·spec D18 "DB-backed durable").
- **Don't verify-email 링크 경로를 임의로 정하지 마라.** Reason: 평문 토큰은 `${origin}/verify-email?token=...`(요청 origin 기준 절대 URL)로 만든다. UI 페이지(`/verify-email`)는 task-08 소관 — 이 task는 링크 형식만 고정하고 새 env var를 추가하지 않는다(`new URL(req.url).origin` 사용, `trustHost:true`와 정합).
