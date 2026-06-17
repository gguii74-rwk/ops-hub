import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma client", () => {
  it("is a constructed singleton exposing model delegates", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.outboxEvent).toBeDefined();
  });
});
