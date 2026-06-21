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
    // iat은 @auth/core가 표준 발급(초 단위). 세션 무효화는 DB 시각 > iat 비교로 판단.
  }
}
