import { describe, it, expect } from "vitest";
import { MailDeliveryStatus, Prisma } from "@prisma/client";

describe("Phase 4 schema", () => {
  it("MailDeliveryStatus enum 3종이 생성되어 있다", () => {
    expect(MailDeliveryStatus.SENDING).toBe("SENDING");
    expect(MailDeliveryStatus.SENT).toBe("SENT");
    expect(MailDeliveryStatus.FAILED).toBe("FAILED");
  });

  it("WorkflowTaskEvent 모델이 Prisma DMMF에 존재한다", () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain("WorkflowTaskEvent");
  });

  it("MailDelivery에 status/bodyHtml/errorMessage 필드가 있고 sentAt은 nullable이다", () => {
    const mail = Prisma.dmmf.datamodel.models.find((m) => m.name === "MailDelivery")!;
    const byName = Object.fromEntries(mail.fields.map((f) => [f.name, f]));
    expect(byName.status).toBeDefined();
    expect(byName.bodyHtml).toBeDefined();
    expect(byName.errorMessage).toBeDefined();
    expect(byName.sentAt.isRequired).toBe(false);
  });
});
