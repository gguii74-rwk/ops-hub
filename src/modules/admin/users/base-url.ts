import "server-only";

// 링크의 host가 canonical과 다르면 토큰 생성 전 거부(finding F — host 스푸핑 차단).
export class HostMismatchError extends Error {}

// canonical base URL: 신규 env 없이 NextAuth와 동형으로 AUTH_URL 우선·NEXTAUTH_URL 폴백.
function canonicalBaseUrl(): URL {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!raw) throw new Error("AUTH_URL/NEXTAUTH_URL이 설정되지 않았습니다(메일 링크 canonical base URL 필요).");
  return new URL(raw);
}

// 검증 메일 링크를 canonical origin으로 생성한다(요청 Host/X-Forwarded-Host 신뢰 금지, finding F).
// 들어온 Host·X-Forwarded-Host가 canonical host와 다르면 토큰이 공격자 origin 링크에 실리는 것을
// 막기 위해 링크를 만들기 전(=토큰을 메일에 넣기 전)에 HostMismatchError를 던진다.
export function buildVerifyLink(req: Request, plainToken: string): string {
  const canonical = canonicalBaseUrl();
  // 프록시가 전달하는 host 후보 — 둘 중 하나라도 canonical과 다르면 스푸핑으로 간주해 거부.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");
  for (const candidate of [forwardedHost, host]) {
    if (candidate && candidate.toLowerCase() !== canonical.host.toLowerCase()) {
      throw new HostMismatchError(`신뢰할 수 없는 host: ${candidate}`);
    }
  }
  // 링크는 항상 canonical origin 기준(요청 url의 origin을 쓰지 않는다).
  return `${canonical.origin}/verify-email?token=${plainToken}`;
}
