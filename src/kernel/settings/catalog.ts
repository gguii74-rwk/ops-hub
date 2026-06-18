import "server-only";
import { z } from "zod";
import type { SettingEntry } from "./registry";

export const CATALOG: readonly SettingEntry[] = [
  // --- security (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.database",
    category: "security",
    order: 10,
    title: "데이터베이스 연결",
    description: "PostgreSQL 연결 문자열(런타임 secret).",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "DATABASE_URL", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.auth",
    category: "security",
    order: 11,
    title: "인증 secret",
    description: "NextAuth 세션 서명 secret(NEXTAUTH_SECRET 또는 AUTH_SECRET).",
    permission: { resource: "admin.settings", action: "view" },
    envVars: [{ name: "NEXTAUTH_SECRET", kind: "value", aliases: ["AUTH_SECRET"] }],
  },
  // --- integrations (envSecret) ---
  {
    kind: "envSecret",
    key: "secret.google",
    category: "integrations",
    order: 20,
    title: "Google 서비스 계정",
    description: "Google API 서비스 계정 키 파일.",
    permission: { resource: "integrations.google", action: "view" },
    envVars: [{ name: "GOOGLE_APPLICATION_CREDENTIALS", kind: "filePath" }],
  },
  {
    kind: "envSecret",
    key: "secret.smtp",
    category: "integrations",
    order: 21,
    title: "SMTP 비밀번호",
    description: "메일 발송 SMTP 계정 비밀번호.",
    permission: { resource: "integrations.smtp", action: "view" },
    envVars: [{ name: "SMTP_PASSWORD", kind: "value" }],
  },
  {
    kind: "envSecret",
    key: "secret.libreoffice",
    category: "integrations",
    order: 22,
    title: "LibreOffice 경로",
    description: "PDF 변환용 LibreOffice 실행 파일 경로.",
    permission: { resource: "integrations.templates", action: "view" },
    envVars: [{ name: "LIBREOFFICE_PATH", kind: "filePath" }],
  },
  // --- integrations (systemSetting) ---
  {
    kind: "systemSetting",
    key: "integrations.smtp.host",
    category: "integrations",
    order: 30,
    title: "SMTP 호스트",
    description: "메일 발송 서버 호스트명.",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.string(), // 빈 문자열="미설정"으로 허용. 완성도 판정은 integrations 상태(task-06)가 length>0로 본다.
    default: "",
    audit: "full",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.smtp.port",
    category: "integrations",
    order: 31,
    title: "SMTP 포트",
    description: "메일 발송 서버 포트(1–65535).",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.coerce.number().int().min(1).max(65535),
    default: 587,
    audit: "full",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.smtp.fromAddress",
    category: "integrations",
    order: 32,
    title: "발신 주소",
    description: "메일 기본 발신 이메일 주소.",
    permission: { resource: "integrations.smtp", action: "configure" },
    schema: z.string().email().or(z.literal("")), // 빈 문자열="미설정" 허용, 그 외엔 이메일 형식
    default: "",
    audit: "summary",
    fallbackSafe: false,
  },
  {
    kind: "systemSetting",
    key: "integrations.google.calendarIds",
    category: "integrations",
    order: 33,
    title: "Google 캘린더 목록",
    description: "동기화 대상 Google 캘린더 ID 목록.",
    permission: { resource: "integrations.google", action: "configure" },
    schema: z.array(z.string().min(1)),
    default: [],
    audit: "summary",
    fallbackSafe: false,
  },
  // --- workflows (systemSetting) ---
  {
    kind: "systemSetting",
    key: "workflows.weeklyReport.defaultRecipients",
    category: "workflows",
    order: 40,
    title: "주간보고 기본 수신자",
    description: "주간보고 메일 기본 수신자 이메일 목록.",
    permission: { resource: "workflows.weekly", action: "configure" },
    schema: z.array(z.string().email()),
    default: [],
    audit: "summary",
    fallbackSafe: true,
  },
  // --- workflows (relational, 편집기 Phase 4) ---
  {
    kind: "relational",
    key: "workflows.billing.config",
    category: "workflows",
    order: 41,
    title: "대금청구 설정",
    description: "연도별 계약·청구 설정(전용 화면에서 관리, Phase 4).",
    permission: { resource: "workflows.billing", action: "configure" },
    model: "BillingConfig",
    manageHref: "/admin/settings/billing",
  },
];

export const SYSTEM_KEYS: ReadonlySet<string> = new Set(
  CATALOG.filter((e) => e.kind === "systemSetting").map((e) => e.key),
);

export function getEntry(key: string): SettingEntry | undefined {
  return CATALOG.find((e) => e.key === key);
}
