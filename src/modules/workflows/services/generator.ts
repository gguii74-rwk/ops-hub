import "server-only";
import type { GeneratorResult } from "../types";
import { createGeneratedFiles } from "../repositories";

// GeneratorResult.files를 GeneratedFile로 기록한다(spec §11). 실제 generate 구현·등록은 후속 sub-project.
export async function recordGeneratedFiles(taskId: string, result: GeneratorResult): Promise<void> {
  await createGeneratedFiles(taskId, result.files);
}
