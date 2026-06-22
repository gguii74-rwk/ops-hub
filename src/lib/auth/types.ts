export type SystemRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
export type EmploymentType = "REGULAR" | "CONTRACTOR";
export type JobFunction = "PM" | "DEVELOPER" | "CONTENT_MANAGER" | "CIVIL_RESPONSE";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  systemRole: SystemRole;
  employmentType: EmploymentType;
  jobFunction: JobFunction;
  mustChangePassword: boolean; // 신규(D17) — UI가 강제변경 진입에 사용. API 차단은 권한 게이트가 별도로 수행.
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
    // 토큰 발급시각(ms). session 콜백이 무효 판정에 쓴 발급시각(token.iatMs)을 실어, 서버 재검증(verifySession 등)이
    // Date.now()가 아닌 동일 발급시각 기준으로 무효화를 판단하게 한다(F-FED — auth()와 2차 DB read 사이 TOCTOU 차단).
    // ms 정밀도 — 표준 JWT iat(초)는 같은 초 내 토큰을 구분 못 해 강제 비번변경 직후 재로그인 lockout이 났다(통합리뷰 finding).
    iatMs?: number;
  }
  interface User {
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
    mustChangePassword: boolean; // 신규 — authorize가 반환(아래 step 6)
    status: string;             // 신규 — authorize가 반환(로그인 시점 status; 세션 재검증은 DB가 권위)
  }
}

// next-auth/jwt re-exports the JWT interface from here; augment the source module
// directly — augmenting "next-auth/jwt" fails under moduleResolution:bundler (TS2664).
// Consumers importing JWT must import from "@auth/core/jwt" to see these fields.
declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
    mustChange: boolean; // 신규 — 로그인 시점 강제변경 플래그(session 콜백이 DB로 재확인해 최종 결정)
    status: string;      // 신규 — 로그인 시점 status(세션 재검증은 DB가 권위)
    // 표준 iat(@auth/core)은 초 단위라 같은 초 내 토큰을 구분 못 한다. sign-in 시 jwt 콜백이 ms 발급시각을
    // iatMs에 실어, 세션 무효화 판정(DB 시각 > iatMs)이 같은 초 재로그인도 정확히 구분한다.
    iatMs?: number;
  }
}
