import { z } from "zod";
export const setCellSchema = z.object({
  effect: z.enum(["none", "ALLOW", "DENY"]),
  scope: z.enum(["own", "team", "all"]).default("all"),
});
export type SetCellInput = z.infer<typeof setCellSchema>;
