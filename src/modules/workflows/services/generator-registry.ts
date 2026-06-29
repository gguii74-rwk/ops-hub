import "server-only";
import type { WorkflowKind } from "@prisma/client";
import type { GeneratorPort } from "../types";
import { NotImplementedError } from "../types";
import { billingGenerator } from "./billing-generator";

// kind 디스패치(D6). 후속 sub-project는 여기 등록만으로 generate/send/download 라우트 재사용.
export const GENERATORS: Partial<Record<WorkflowKind, GeneratorPort>> = {
  BILLING: billingGenerator,
};

export function getGenerator(kind: WorkflowKind): GeneratorPort {
  const g = GENERATORS[kind];
  if (!g) throw new NotImplementedError(`'${kind}' 생성기가 등록되지 않았습니다.`);
  return g;
}
