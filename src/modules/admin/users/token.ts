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
