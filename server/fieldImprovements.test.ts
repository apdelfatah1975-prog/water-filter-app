import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers/filterManagement.ts", import.meta.url), "utf8");
const technician = readFileSync(new URL("../client/src/pages/TechnicianPreview.tsx", import.meta.url), "utf8");
const workOrders = readFileSync(new URL("../client/src/pages/WorkOrders.tsx", import.meta.url), "utf8");
const customersPage = readFileSync(new URL("../client/src/pages/Customers.tsx", import.meta.url), "utf8");
const inventoryPage = readFileSync(new URL("../client/src/pages/Inventory.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");

describe("field improvements contracts", () => {
  it("keeps visit TDS and before/after photo references in the schema", () => {
    expect(schema).toContain('tdsIn: int("tdsIn")');
    expect(schema).toContain('tdsOut: int("tdsOut")');
    expect(schema).toContain('photoBeforeKey: varchar("photoBeforeKey"');
    expect(schema).toContain('photoAfterKey: varchar("photoAfterKey"');
    expect(schema).toContain('photoSlot: mysqlEnum("photoSlot"');
  });

  it("exposes photo slots, TDS persistence, and daily closing procedure", () => {
    expect(router).toContain('photoSlot: z.enum(["before", "after", "general"]).optional()');
    expect(router).toContain("tdsIn: z.number().int().nonnegative().max(100000).optional().nullable()");
    expect(router).toContain("tdsOut: z.number().int().nonnegative().max(100000).optional().nullable()");
    expect(router).toContain("dailyCashClosing: adminProcedure");
    expect(router).toContain('movementType: "outgoing"');
  });

  it("keeps the technician photo workflow client-side and constrained", () => {
    expect(technician).toContain("compressFieldPhoto");
    expect(technician).toContain("1200 / Math.max");
    expect(technician).toContain('"image/webp"');
    expect(technician).toContain("200 * 1024");
    expect(technician).toContain("photoBeforeDataUrl");
    expect(technician).toContain("photoAfterDataUrl");
    expect(technician).toContain("TDS قبل الصيانة");
    expect(technician).toContain("TDS بعد الصيانة");
  });

  it("shows TDS and daily cash closing in the manager work-orders view", () => {
    expect(workOrders).toContain("dailyCashClosing.useQuery");
    expect(workOrders).toContain("تقفيل النقدية اليومي");
    expect(workOrders).toContain("selectedOrder.tdsIn");
    expect(workOrders).toContain("صورة قبل الصيانة");
    expect(workOrders).toContain("صورة بعد الصيانة");
  });

  it("keeps large customer imports central and technician-assigned", () => {
    expect(router).toContain("rows: z.array(customerImportRowInput).min(1).max(1000)");
    expect(router).toContain("const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);");
    expect(router).toContain("assignedTechnicianId: assignedTechnician?.id ?? null");
    expect(router).toContain("clientOperationId: operationId");
  });

  it("attributes first-visit deductions and keeps the inventory log readable", () => {
    expect(router).toContain('movementType: "outgoing"');
    expect(router).toContain("customerId, notes: `منصرف تلقائي من أول زيارة للعميل ${input.name}`");
    expect(inventoryPage).toContain("movement.technicianName || \"—\"");
    expect(inventoryPage).toContain("movement.customerName || \"—\"");
  });

  it("prevents customer clipping and removes location actions from sent orders", () => {
    expect(customersPage).toContain("min-w-0 w-full max-w-none");
    expect(customersPage).toContain("overflow-x-clip");
    expect(workOrders).toContain("compact labels hideLocationActions className=\"shrink-0\"");
    expect(workOrders).toContain("compact labels hideLocationActions className=\"mt-3\"");
    expect(styles).toContain("box-sizing: border-box;");
  });
});
