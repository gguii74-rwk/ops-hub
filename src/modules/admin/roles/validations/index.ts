import { z } from "zod";
import { PERMISSION_GROUP_KEYS } from "@/kernel/access/catalog";

export const setCellSchema = z.object({
  effect: z.enum(["none", "ALLOW", "DENY"]),
  scope: z.enum(["own", "team", "all"]).default("all"),
});
export type SetCellInput = z.infer<typeof setCellSchema>;

export const bulkSetSchema = z.object({
  resourcePrefix: z.string().refine(
    (v) => (PERMISSION_GROUP_KEYS as readonly string[]).includes(v),
    "unknown group",
  ),
  effect: z.enum(["none", "ALLOW", "DENY"]),
});
export type BulkSetInput = z.infer<typeof bulkSetSchema>;
