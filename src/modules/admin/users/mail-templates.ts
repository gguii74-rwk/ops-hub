const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

// 검증 겸 set-password 안내 메일(D16). link는 평문 토큰을 쿼리로 담은 절대 URL(라우트가 canonical base URL로 생성 — finding F).
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
