export interface ConfigForm {
  year: number;
  projectName: string;
  contractNumber: string;
  contractAmount: string; // raw input
  monthlyAmount: string;
  contractAmountKor: string;
  monthlyAmountKor: string;
}

export const emptyConfigForm: ConfigForm = {
  year: 0, projectName: "", contractNumber: "",
  contractAmount: "", monthlyAmount: "", contractAmountKor: "", monthlyAmountKor: "",
};

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
export const MAX_MONTHLY = Math.floor(MAX_SAFE / 12); // J4: 12회차 누계도 안전정수 내

// 클라 안내용 검증(서버 zod가 권위). 첫 오류 메시지 또는 null.
export function validateConfigForm(f: ConfigForm): string | null {
  if (!f.projectName.trim()) return "사업명을 입력하세요.";
  if (!f.contractNumber.trim()) return "계약번호를 입력하세요.";
  if (!f.contractAmountKor.trim() || !f.monthlyAmountKor.trim()) return "금액(한글)을 입력하세요.";
  const c = Number(f.contractAmount);
  const m = Number(f.monthlyAmount);
  if (!Number.isInteger(c) || c <= 0 || c > MAX_SAFE) return "총 계약금액은 양의 정수(상한 내)여야 합니다.";
  if (!Number.isInteger(m) || m <= 0 || m > MAX_MONTHLY) return "월 청구금액은 양의 정수(상한 내)여야 합니다.";
  return null;
}

export function formToConfigPayload(f: ConfigForm) {
  return {
    year: f.year,
    projectName: f.projectName.trim(),
    contractNumber: f.contractNumber.trim(),
    contractAmount: Number(f.contractAmount),
    monthlyAmount: Number(f.monthlyAmount),
    contractAmountKor: f.contractAmountKor.trim(),
    monthlyAmountKor: f.monthlyAmountKor.trim(),
  };
}
