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
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
  interface User {
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
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
  }
}
