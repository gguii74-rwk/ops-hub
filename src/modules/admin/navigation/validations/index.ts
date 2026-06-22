import { z } from "zod";
import { expectedUpdatedAt } from "@/kernel/optimistic";
import { HREF_PATTERN } from "../href";

const label = z.string().trim().min(1, "라벨은 필수입니다.").max(100);
// null = 그룹 헤더(이동 없음). string이면 origin-relative만(D7).
const href = z.union([z.null(), z.string().regex(HREF_PATTERN, "유효한 내부 경로(/로 시작)만 허용됩니다.")]);
const parentId = z.string().min(1).nullable();             // null = 대메뉴
const requiredPermissionId = z.string().min(1).nullable(); // null = 공개(D8)

// 생성: key는 입력 아님(D17 — strip). sortOrder는 서버가 형제 말미로 부여.
export const createNavSchema = z.object({
  label,
  href,
  parentId,
  requiredPermissionId,
});

// 수정: 부분 patch. parentId는 없음(이동은 reparent 전용 — strip).
export const updateNavSchema = z.object({
  label: label.optional(),
  href: href.optional(),
  requiredPermissionId: requiredPermissionId.optional(),
  isActive: z.boolean().optional(),
});

// 재정렬: 형제 묶음 전체의 새 순서 + 각 형제의 관측 updatedAt(P6 lost-update 차단).
// 중복 ID 거부(P2 — 중복이 통과하면 한 행을 두 번 갱신·다른 형제 누락으로 sortOrder 손상).
// updatedAt은 ISO로 받고 라우트가 Date로 변환(다른 변경 경로와 동일 — SC-7).
export const reorderNavSchema = z
  .object({
    parentId: z.string().min(1).nullable(),
    orderedItems: z.array(z.object({ id: z.string().min(1), updatedAt: expectedUpdatedAt })).min(1),
  })
  .refine((v) => new Set(v.orderedItems.map((i) => i.id)).size === v.orderedItems.length, {
    message: "중복된 메뉴 ID가 있습니다.",
    path: ["orderedItems"],
  });

// 이동(reparent): 대상 부모(null=대메뉴 승격). id는 라우트 param.
export const reparentNavSchema = z.object({
  newParentId: z.string().min(1).nullable(),
});

// 낙관락 body(SC-7) — 수정·이동·삭제는 updatedAt 동반.
export const updateNavBodySchema = updateNavSchema.extend({ updatedAt: expectedUpdatedAt });
export const reparentNavBodySchema = reparentNavSchema.extend({ updatedAt: expectedUpdatedAt });
// 삭제: updatedAt + 확인 시점 직속 자식 ID 집합(P9). 서비스가 현재 DB 자식 집합과 대조, 불일치 시 409
// (확인 화면 렌더 후 추가/이동된 자식이 확인 없이 cascade 삭제되는 TOCTOU 차단). leaf는 []. 누락 거부=fail-closed.
export const deleteNavBodySchema = z.object({
  updatedAt: expectedUpdatedAt,
  confirmedChildIds: z.array(z.string().min(1)),
});

export type CreateNavInput = z.infer<typeof createNavSchema>;
export type UpdateNavInput = z.infer<typeof updateNavSchema>;
export type ReparentNavInput = z.infer<typeof reparentNavSchema>;
// reorder 서비스/repo 레벨 타입 — 라우트가 orderedItems.updatedAt(ISO)을 Date로 변환해 넘긴다
// (z.infer는 updatedAt이 string이라 별도 정의 — SC-6).
export interface ReorderNavInput {
  parentId: string | null;
  orderedItems: Array<{ id: string; updatedAt: Date }>;
}
