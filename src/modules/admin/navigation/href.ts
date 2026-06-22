// origin-relative만 하드 허용(D7). 선두 // 금지(protocol-relative 외부링크 차단). 스킴(:)·백슬래시·
// 인코딩 슬래시(%)·공백은 문자클래스에 없어 자동 거부. 그룹 헤더는 href 없음(null) — 이 정규식은 string 전용.
export const HREF_PATTERN = /^\/(?!\/)[A-Za-z0-9/_-]*$/;

// 소프트 경고용 큐레이트 내부 라우트 prefix. 형식은 통과하나 여기에 없으면 "죽은 링크일 수 있음" 경고
// (저장은 허용 — 페이지 선출시 등록 대비 — D7). 유지 부담이 크면 형식 검증만으로 축소 가능.
export const INTERNAL_ROUTE_PREFIXES = ["/dashboard", "/calendar", "/workflows", "/leave", "/admin"] as const;

export function isKnownInternalRoute(href: string): boolean {
  return INTERNAL_ROUTE_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`));
}
