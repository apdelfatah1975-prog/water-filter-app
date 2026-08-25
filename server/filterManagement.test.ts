import { describe, expect, it, vi } from "vitest";
import { allowedTechnicianAccounts, cashTransactions, customers, inventoryItems, inventoryMovements, notificationSettings, reminders, visits, serviceTypes, serviceTypeItems, users, visitItems, workOrderProofs, technicianLocations } from "../drizzle/schema";
import { appRouter } from "./routers";
import { classifyCashParty } from "./routers/filterManagement";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));

const TEST_PIN = "1234";
const TEST_PIN_HASH = "test-salt-for-vitest:c872f951b643e146075a3a65ee17f534ce1833ce47e7f8d80d70411e185dd82a9def0d82315ac8f743256bd488bdbac95da97a2261b57d3ccf3483dd73e7e16a";

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      name: "مدير الاختبار",
      email: "test@example.com",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("واجهات إدارة فلاتر المياه", () => {
  it("يصنف نوع الطرف في عمليات الخزينة بشكل مستقل", () => {
    expect(classifyCashParty({ sourceVisitId: 12, category: "تحصيل صيانة", recipientName: "أحمد", notes: "عميل" })).toBe("customer");
    expect(classifyCashParty({ category: "راتب فني", recipientName: "أحمد", notes: null })).toBe("technician");
    expect(classifyCashParty({ category: "بنزين", recipientName: "محطة الوقود", notes: null })).toBe("entity");
  });
  it("يمسح كل البيانات التشغيلية بما فيها الخزينة والمخزن مع الحفاظ على إعدادات المستخدم", async () => {
    const deletedTables: unknown[] = [];
    const rowsByTable = new Map<unknown, unknown[]>([
      [notificationSettings, [{ ownerId: 1, pinHash: TEST_PIN_HASH }]],
      [customers, [{ id: 11 }]],
      [visits, [{ id: 12 }]],
      [reminders, [{ id: 13 }]],
      [cashTransactions, [{ id: 14 }]],
      [inventoryItems, [{ id: 15 }]],
      [inventoryMovements, [{ id: 16 }]],
      [serviceTypes, [{ id: 17 }]],
      [serviceTypeItems, [{ id: 18 }]],
      [visitItems, [{ id: 19 }]],
      [workOrderProofs, [{ id: 20 }]],
      [technicianLocations, [{ id: 21 }]],
    ]);
    const db = {
      select: () => ({ from: (table: unknown) => ({ where: () => { const result = Promise.resolve(rowsByTable.get(table) ?? []) as Promise<unknown[]> & { limit?: () => Promise<unknown[]> }; result.limit = async () => rowsByTable.get(table) ?? []; return result; } }) }),
      delete: (table: unknown) => ({ where: async () => { deletedTables.push(table); } }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await appRouter.createCaller(createContext()).filters.customers.deleteAllData({ pin: TEST_PIN, confirmation: "مسح كل بيانات التطبيق" });
    expect(result.success).toBe(true);
    expect(deletedTables).toEqual([workOrderProofs, visitItems, reminders, cashTransactions, visits, serviceTypeItems, serviceTypes, inventoryMovements, inventoryItems, technicianLocations, customers]);
    expect(deletedTables).not.toContain(notificationSettings);
  });

  it("يرفض المسح الشامل إذا لم يطابق نص التأكيد المطلوب", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.filters.customers.deleteAllData({ pin: TEST_PIN, confirmation: "مسح العملاء فقط" as "مسح كل بيانات التطبيق" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ينشئ العميل وأول زيارة والفني والتذكير وإيراد التركيب تلقائيًا", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: table === users ? () => ({ where: () => ({ limit: async () => [{ id: 9, name: "أحمد", displayName: "أحمد" }] }) }) : undefined,
          where: () => ({ limit: async () => [] }),
        }),
      }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { insertCalls.push({ table, values }); return [{ insertId: table === customers ? 77 : table === visits ? 88 : 0 }]; } }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    const visitDate = new Date("2026-01-01T09:00:00.000Z");

    await expect(caller.filters.customers.create({ name: "عميل جديد", phone: "01000000000", manualCode: "م-١٢", firstVisitType: "installation", firstVisitDate: visitDate, firstTechnicianName: "أحمد", firstCollectedAmount: 12500, firstCollectedCurrency: "SAR" })).resolves.toMatchObject({ id: 77, firstVisitCreated: true, reminderCreated: true });
    expect(insertCalls.find(call => call.table === customers)?.values).toMatchObject({ manualCode: "م-١٢" });
    expect(insertCalls.find(call => call.table === visits)?.values).toMatchObject({ customerId: 77, visitType: "installation", assignedTechnicianId: 9, technicianName: "أحمد", visitDate });
    expect(insertCalls.find(call => call.table === cashTransactions)?.values).toMatchObject({ sourceVisitId: 88, amount: 12500, currency: "SAR", category: "تحصيل تركيب" });
    expect(insertCalls.filter(call => call.table === reminders)).toHaveLength(1);
  });

  it("يمرر قياسات TDS الاختيارية إلى INSERT الزيارة", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return [{ insertId: table === visits ? 56 : 0 }];
        },
      }),
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    await caller.filters.visits.create({
      customerId: 7,
      visitType: "maintenance",
      visitDate: new Date("2026-01-01T09:00:00.000Z"),
      tdsIn: 420,
      tdsOut: 38,
    });
    expect(insertCalls.find(call => call.table === visits)?.values).toMatchObject({ tdsIn: 420, tdsOut: 38 });
  });

  it("ينشئ تذكيرًا بعد 120 يومًا عند تسجيل تركيب أو صيانة فقط", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const reminderUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return [{ insertId: table === visits ? 55 : 0 }];
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => { reminderUpdates.push({ table, values }); },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    const visitDate = new Date("2026-01-01T09:00:00.000Z");

    await expect(caller.filters.visits.create({ customerId: 7, visitType: "installation", visitDate }))
      .resolves.toMatchObject({ id: 55, reminderCreated: true });
    await expect(caller.filters.visits.create({ customerId: 7, visitType: "maintenance", visitDate }))
      .resolves.toMatchObject({ id: 55, reminderCreated: true });
    await expect(caller.filters.visits.create({ customerId: 7, visitType: "cartridge_change", visitDate }))
      .resolves.toMatchObject({ id: 55, reminderCreated: false });

    const reminderCalls = insertCalls.filter(call => call.table === reminders);
    expect(reminderCalls).toHaveLength(2);
    expect(reminderCalls.every(call => call.values.visitId === 55)).toBe(true);
    expect(reminderCalls.every(call => (call.values.reminderDate as Date).toISOString() === "2026-05-01T09:00:00.000Z")).toBe(true);
    expect(reminderUpdates).toEqual([
      { table: reminders, values: { status: "completed" } },
      { table: reminders, values: { status: "completed" } },
      { table: reminders, values: { status: "completed" } },
    ]);
  });

  it("يحفظ مدة المتابعة المرنة على الزيارة والتذكير كي تظهر البطاقة فوراً", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return [{ insertId: table === visits ? 56 : 0 }];
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const visitDate = new Date("2026-01-01T09:00:00.000Z");

    await appRouter.createCaller(createContext()).filters.visits.create({
      customerId: 7,
      visitType: "maintenance",
      visitDate,
      followUpDays: 60,
    });

    const visitInsert = insertCalls.find(call => call.table === visits)?.values;
    const reminderInsert = insertCalls.find(call => call.table === reminders)?.values;
    expect(visitInsert?.nextVisitDate).toEqual(new Date("2026-03-02T09:00:00.000Z"));
    expect(reminderInsert?.reminderDate).toEqual(new Date("2026-03-02T09:00:00.000Z"));
  });

  it("يعيد ملف العميل بموعد محفوظ حتى إذا كانت الزيارة الجديدة بحالة assigned", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T09:00:00.000Z"));
    const nextVisitDate = new Date("2026-05-01T09:00:00.000Z");
    const assignedVisit = {
      id: 56,
      ownerId: 1,
      customerId: 7,
      visitType: "maintenance" as const,
      visitDate: new Date("2026-01-01T09:00:00.000Z"),
      nextVisitDate,
      status: "assigned" as const,
    };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === customers) return { limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] };
            if (table === visits) return { orderBy: async () => [assignedVisit] };
            if (table === reminders) return { orderBy: async () => [] };
            return [];
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    try {
      await expect(appRouter.createCaller(createContext()).filters.customers.get({ id: 7 })).resolves.toMatchObject({
        customer: { followUp: { nextVisitDate, daysRemaining: 89 } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("يعيد ملف العميل بملخص متابعة موحد بعد تسجيل زيارة تركيب", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    const installationVisit = { id: 55, ownerId: 1, customerId: 7, visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === customers) return { limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] };
            if (table === visits) return { orderBy: async () => [installationVisit] };
            if (table === reminders) return { orderBy: async () => [] };
            return [];
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    try {
      await expect(caller.filters.customers.get({ id: 7 })).resolves.toMatchObject({
        customer: {
          id: 7,
          customerCode: "١",
          followUp: {
            lastServiceVisitType: "installation",
            nextVisitDate: new Date("2026-05-01T09:00:00.000Z"),
            daysRemaining: 0,
          },
        },
        visits: [installationVisit],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("يعيد قائمة العملاء بكود العميل وملخص الموعد المشتق من آخر خدمة", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    const installationVisit = { id: 55, ownerId: 1, customerId: 7, visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === customers) return { orderBy: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] };
            if (table === visits) return { orderBy: async () => [installationVisit] };
            return [];
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    try {
      await expect(appRouter.createCaller(createContext()).filters.customers.list({})).resolves.toMatchObject([{
        id: 7,
        customerCode: "١",
        followUp: { nextVisitDate: new Date("2026-05-01T09:00:00.000Z"), daysRemaining: 0 },
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("يفلتر العملاء حسب حالة وموعد المتابعة", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    const customersRows = [
      { id: 7, ownerId: 1, name: "عميل موعد اليوم", phone: "01000000000", address: null, latitude: null, longitude: null, notes: null, createdAt: new Date("2026-01-01T09:00:00.000Z"), updatedAt: new Date("2026-01-01T09:00:00.000Z") },
      { id: 8, ownerId: 1, name: "عميل بلا موعد", phone: "01111111111", address: null, latitude: null, longitude: null, notes: null, createdAt: new Date("2026-01-02T09:00:00.000Z"), updatedAt: new Date("2026-01-02T09:00:00.000Z") },
      { id: 9, ownerId: 1, name: "عميل خلال خمسة أيام", phone: "01222222222", address: null, latitude: null, longitude: null, notes: null, createdAt: new Date("2026-01-03T09:00:00.000Z"), updatedAt: new Date("2026-01-03T09:00:00.000Z") },
      { id: 10, ownerId: 1, name: "عميل بعد خمسة أيام", phone: "01333333333", address: null, latitude: null, longitude: null, notes: null, createdAt: new Date("2026-01-04T09:00:00.000Z"), updatedAt: new Date("2026-01-04T09:00:00.000Z") },
      { id: 11, ownerId: 1, name: "عميل متأخر", phone: "01444444444", address: null, latitude: null, longitude: null, notes: null, createdAt: new Date("2026-01-05T09:00:00.000Z"), updatedAt: new Date("2026-01-05T09:00:00.000Z") },
    ];
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === customers) return { orderBy: async () => customersRows };
            if (table === visits) return { orderBy: async () => [
              { id: 55, ownerId: 1, customerId: 7, visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") },
              { id: 56, ownerId: 1, customerId: 9, visitType: "installation" as const, visitDate: new Date("2026-01-06T09:00:00.000Z") },
              { id: 57, ownerId: 1, customerId: 10, visitType: "installation" as const, visitDate: new Date("2026-01-07T09:00:00.000Z") },
              { id: 58, ownerId: 1, customerId: 11, visitType: "installation" as const, visitDate: new Date("2025-12-31T09:00:00.000Z") },
            ] };
            return [];
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    try {
      await expect(caller.filters.customers.list({ followUpStatus: "today" })).resolves.toHaveLength(1);
      await expect(caller.filters.customers.list({ followUpStatus: "upcoming" })).resolves.toMatchObject([{ id: 7 }, { id: 9 }, { id: 11 }]);
      await expect(caller.filters.customers.list({ followUpStatus: "upcoming" })).resolves.not.toContainEqual(expect.objectContaining({ id: 10 }));
      await expect(caller.filters.customers.list({ followUpStatus: "upcoming" })).resolves.toContainEqual(expect.objectContaining({ id: 11 }));
      await expect(caller.filters.customers.list({ followUpStatus: "none" })).resolves.toMatchObject([{ id: 8 }]);
      await expect(caller.filters.customers.list({ followUpDate: "2026-05-01" })).resolves.toMatchObject([{ id: 7 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("يعيد التذكير المستحق بآخر خدمة وأيام التأخر والعميل المرتبط", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T09:00:00.000Z"));
    const installationVisit = { id: 55, ownerId: 1, customerId: 7, visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") };
    const dueReminder = { id: 14, ownerId: 1, customerId: 7, visitId: 55, status: "pending" as const, reminderDate: new Date("2026-05-01T09:00:00.000Z") };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === reminders) return { orderBy: async () => [dueReminder] };
            if (table === customers) return [{ id: 7, ownerId: 1, name: "عميل اختبار" }];
            if (table === visits) return [installationVisit];
            return [];
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    try {
      await expect(appRouter.createCaller(createContext()).filters.reminders.due()).resolves.toMatchObject([{
        id: 14,
        lastServiceVisitType: "installation",
        lastServiceVisitDate: installationVisit.visitDate,
        daysOverdue: 1,
        customer: { customerCode: "١", followUp: { nextVisitDate: dueReminder.reminderDate, daysRemaining: -1 } },
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ينشر تعديل بيانات العميل فعليًا في القائمة وملفه", async () => {
    const customer = { id: 7, ownerId: 1, name: "قبل التعديل", phone: "01000000000", address: "العنوان القديم", latitude: null, longitude: null, notes: null };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === notificationSettings) return { limit: async () => [{ ownerId: 1, pinHash: TEST_PIN_HASH }] };
            if (table === customers) return { limit: async () => [customer], orderBy: async () => [customer] };
            if (table === visits) return { orderBy: async () => [] };
            if (table === reminders) return { orderBy: async () => [] };
            return [];
          },
        }),
      }),
      update: (_table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            Object.assign(customer, values);
          },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await caller.filters.customers.update({ id: 7, name: "بعد التعديل", phone: "01111111111", address: "العنوان الجديد", latitude: null, longitude: null, notes: "ملاحظة جديدة", pin: TEST_PIN });

    await expect(caller.filters.customers.list({})).resolves.toMatchObject([{
      id: 7,
      name: "بعد التعديل",
      phone: "01111111111",
      address: "العنوان الجديد",
    }]);
    await expect(caller.filters.customers.get({ id: 7 })).resolves.toMatchObject({
      customer: {
        name: "بعد التعديل",
        phone: "01111111111",
        address: "العنوان الجديد",
      },
    });
  });

  it("ينشر تعديل العميل إلى التذكيرات ولوحة التحكم من المصدر نفسه", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T09:00:00.000Z"));
    const customer = { id: 7, ownerId: 1, name: "قبل التعديل", phone: "01000000000", address: "العنوان القديم", latitude: null, longitude: null, notes: null };
    const upcomingVisit = { id: 55, ownerId: 1, customerId: 7, visitType: "maintenance" as const, visitDate: new Date("2026-05-03T09:00:00.000Z") };
    const dueReminder = { id: 14, ownerId: 1, customerId: 7, visitId: 55, status: "pending" as const, alertedAt: null, reminderDate: new Date("2026-05-01T09:00:00.000Z") };
    const chain = (rows: unknown[]) => {
      const query = {
        orderBy: () => query,
        limit: () => query,
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === notificationSettings) return chain([{ ownerId: 1, pinHash: TEST_PIN_HASH }]);
            if (table === customers) return chain([customer]);
            if (table === visits) return chain([upcomingVisit]);
            if (table === reminders) return chain([dueReminder]);
            if (table === inventoryItems || table === inventoryMovements || table === cashTransactions) return chain([]);
            return chain([]);
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => { Object.assign(customer, values); },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    try {
      await caller.filters.customers.update({ id: 7, name: "بعد التعديل", phone: "01111111111", address: "العنوان الجديد", latitude: null, longitude: null, notes: "ملاحظة جديدة", pin: TEST_PIN });
      const dashboard = await caller.filters.dashboard();
      expect(dashboard.dueReminders[0]?.customer).toMatchObject({ name: "بعد التعديل", phone: "01111111111", address: "العنوان الجديد" });
      expect(dashboard.upcomingVisits[0]?.customer).toMatchObject({ name: "بعد التعديل", phone: "01111111111", address: "العنوان الجديد" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("يوقف ظهور التذكير في التنبيهات بعد تسجيل زيارة للعميل", async () => {
    let reminderStatus = "pending";
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === customers) return { limit: async () => [{ id: 7, ownerId: 1, name: "عميل اختبار" }] };
            if (table === notificationSettings) return { limit: async () => [{ ownerId: 1, leadDays: 1, alertHour: 9, alertMinute: 0, timezoneOffsetMinutes: 0, scheduleCronTaskUid: null, pinHash: TEST_PIN_HASH }] };
            if (table === reminders) return { orderBy: async () => reminderStatus === "pending" ? [{ id: 14, ownerId: 1, customerId: 7, status: "pending", alertedAt: null, reminderDate: new Date("2026-01-01T09:00:00.000Z") }] : [] };
            return [];
          },
        }),
      }),
      insert: () => ({ values: async () => [{ insertId: 71 }] }),
      update: () => ({
        set: (values: { status: string }) => ({
          where: async () => { reminderStatus = values.status; },
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await caller.filters.visits.create({ customerId: 7, visitType: "follow_up", visitDate: new Date("2026-01-02T09:00:00.000Z") });
    await expect(caller.filters.reminders.alerts()).resolves.toEqual([]);
  });

  it("لا ينشئ زيارة مكررة عند إعادة مزامنة معرف العملية نفسه", async () => {
    const insert = vi.fn();
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => table === visits
            ? { limit: async () => [{ id: 99, ownerId: 1, visitType: "maintenance" }] }
            : { limit: async () => [] },
        }),
      }),
      insert,
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.visits.create({
      customerId: 7,
      visitType: "maintenance",
      visitDate: new Date("2026-01-02T09:00:00.000Z"),
      clientOperationId: "26c4b0f0-e34e-4a89-8d6f-4dbdfd34403e",
    })).resolves.toEqual({ id: 99, reminderCreated: true, alreadySynced: true });

    expect(insert).not.toHaveBeenCalled();
  });

  it("يعدل تاريخ أول زيارة ويحدث تذكيرها دون إنشاء تحصيل جديد", async () => {
    const firstVisit = { id: 55, ownerId: 1, customerId: 7, visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") };
    const pendingReminder = { id: 14, ownerId: 1, customerId: 7, visitId: 55, status: "pending" as const, reminderDate: new Date("2026-05-01T09:00:00.000Z") };
    const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === notificationSettings ? [{ ownerId: 1, pinHash: TEST_PIN_HASH }] : table === visits ? [firstVisit] : table === reminders ? [pendingReminder] : [] }) }) }),
      update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updateCalls.push({ table, values }); } }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    const correctedDate = new Date("2026-01-05T11:30:00.000Z");

    await expect(caller.filters.visits.updateDate({ visitId: 55, visitDate: correctedDate, pin: TEST_PIN })).resolves.toEqual({ success: true });
    expect(updateCalls.filter(call => call.table === cashTransactions)).toHaveLength(1);
    expect(updateCalls.find(call => call.table === visits)?.values).toEqual({ visitDate: correctedDate });
    expect(updateCalls.find(call => call.table === reminders)?.values).toEqual({ reminderDate: new Date("2026-05-05T11:30:00.000Z") });
  });

  it("يرفض صرف المخزون عندما لا يكفي الرصيد", async () => {
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            table === inventoryItems
              ? { limit: async () => [{ id: 7, ownerId: 1, openingQuantity: 3 }] }
              : [{ inventoryItemId: 7, movementType: "outgoing", quantity: 1 }],
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.inventory.createMovement({
      inventoryItemId: 7,
      movementType: "outgoing",
      quantity: 3,
      movementDate: new Date(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("يعيد خطأ عدم العثور عند تحديث تذكير غير موجود", async () => {
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({ limit: async () => table === notificationSettings ? [{ ownerId: 1, pinHash: TEST_PIN_HASH }] : [] }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.reminders.updateStatus({ id: 404, status: "completed", pin: TEST_PIN }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("يمنع تحديث تذكير مملوك لمستخدم آخر", async () => {
    const otherOwnersReminder = { id: 19, ownerId: 2, status: "pending" };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          // الاستعلام يقيّد النتيجة بـ ownerId للمستخدم الحالي، لذا لا يظهر تذكير المستخدم الآخر.
          where: () => ({ limit: async () => table === notificationSettings ? [{ ownerId: 1, pinHash: TEST_PIN_HASH }] : otherOwnersReminder.ownerId === 1 ? [otherOwnersReminder] : [] }),
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.reminders.updateStatus({ id: 19, status: "dismissed", pin: TEST_PIN }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("يسجل المبلغ المحصل من الزيارة كإيراد مرتبط بها وبالعملة المختارة", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const customer = { id: 7, ownerId: 1, name: "عميل التحصيل" };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: table === users ? () => ({ where: () => ({ limit: async () => [{ id: 15, name: "الفني أحمد", displayName: "الفني أحمد" }] }) }) : undefined,
          where: () => ({ limit: async () => table === customers ? [customer] : [] }),
        }),
      }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { insertCalls.push({ table, values }); return [{ insertId: table === visits ? 123 : 456 }]; } }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.visits.create({
      customerId: 7,
      visitType: "follow_up",
      visitDate: new Date("2026-08-15T09:00:00.000Z"),
      technicianName: "الفني أحمد",
      collectedAmount: 27500,
      collectedCurrency: "SAR",
    })).resolves.toEqual({ id: 123, reminderCreated: false, alreadySynced: false });

    expect(insertCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: cashTransactions, values: expect.objectContaining({ ownerId: 1, transactionType: "income", amount: 27500, currency: "SAR", sourceVisitId: 123, recipientName: "الفني أحمد", notes: "العميل: عميل التحصيل | إيراد أُنشئ تلقائيًا من تسجيل الزيارة بواسطة الفني أحمد" }) }),
    ]));
  });

  it("يسجل عملية خزينة ضمن مالك الحساب الحالي", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return [{ insertId: 91 }];
        },
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.cash.create({
      transactionType: "expense",
      amount: 350,
      category: "مستلزمات تشغيل",
      transactionDate: new Date("2026-08-15T09:00:00.000Z"),
      recipientName: "فني الصيانة",
    })).resolves.toEqual({ id: 91 });

		expect(insertCalls).toEqual([expect.objectContaining({
			table: cashTransactions,
			values: expect.objectContaining({ ownerId: 1, amount: 350, transactionType: "expense" }),
		})]);
	});

  it("يحمي حذف عملية الخزينة بالرقم السري", async () => {
    let deleted = false;
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({ limit: async () => table === notificationSettings ? [{ ownerId: 1, pinHash: TEST_PIN_HASH }] : [] }),
        }),
      }),
      delete: () => ({ where: async () => { deleted = true; } }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    await expect(caller.filters.cash.delete({ id: 91, pin: "9999" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleted).toBe(false);
    await expect(caller.filters.cash.delete({ id: 91, pin: TEST_PIN })).resolves.toEqual({ success: true });
    expect(deleted).toBe(true);
  });
  it("يعيد حساب وقت الإشعار القادم فور حفظ وقت تنبيه جديد", async () => {
		let savedSettings = {
			ownerId: 1,
			leadDays: 1,
			alertHour: 9,
			alertMinute: 0,
			timezoneOffsetMinutes: 180,
			scheduleCronTaskUid: null,
		};
		const pendingReminder = {
			id: 23,
			ownerId: 1,
			customerId: 7,
			status: "pending" as const,
			alertedAt: null,
			reminderDate: new Date("2026-05-10T21:00:00.000Z"),
		};
		const db = {
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						if (table === notificationSettings) return { limit: async () => [savedSettings] };
						if (table === reminders) return { orderBy: async () => [pendingReminder] };
						if (table === customers) return [{ id: 7, ownerId: 1, name: "عميل الاختبار" }];
						return [];
					},
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					onDuplicateKeyUpdate: async () => {
						savedSettings = { ...savedSettings, ...values } as typeof savedSettings;
					},
				}),
			}),
		};
		vi.mocked(getDb).mockResolvedValue(db as never);
		const caller = appRouter.createCaller(createContext());

		const beforeSave = await caller.filters.notifications.nextAlert();
		expect(beforeSave?.alertDate.toISOString()).toBe("2026-05-10T06:00:00.000Z");

		await caller.filters.notifications.saveSettings({
			leadDays: 1,
			alertHour: 14,
			alertMinute: 30,
			timezoneOffsetMinutes: 180,
		});

		const afterSave = await caller.filters.notifications.nextAlert();
		expect(afterSave?.alertDate.toISOString()).toBe("2026-05-10T11:30:00.000Z");
	});

	it("يوفر التذكير المستحق والقريب للمصادر التي يعرضها بانر لوحة التحكم", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
		const dueReminder = {
			id: 81,
			ownerId: 1,
			customerId: 7,
			status: "pending" as const,
			alertedAt: null,
			reminderDate: new Date("2026-08-14T12:00:00.000Z"),
		};
		const upcomingReminder = {
			id: 82,
			ownerId: 1,
			customerId: 7,
			status: "pending" as const,
			alertedAt: null,
			reminderDate: new Date("2026-08-16T15:00:00.000Z"),
		};
		let reminderQueryCount = 0;
		const db = {
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						if (table === notificationSettings) {
							return { limit: async () => [{ ownerId: 1, leadDays: 1, alertHour: 9, alertMinute: 0, timezoneOffsetMinutes: 0, scheduleCronTaskUid: null, pinHash: TEST_PIN_HASH }] };
						}
						if (table === reminders) {
							const rows = reminderQueryCount++ === 0 ? [dueReminder] : [upcomingReminder];
							return { orderBy: async () => rows };
						}
						if (table === customers) return [{ id: 7, ownerId: 1, name: "عميل الاختبار" }];
						return [];
					},
				}),
			}),
		};
		vi.mocked(getDb).mockResolvedValue(db as never);
		const caller = appRouter.createCaller(createContext());

		try {
			await expect(caller.filters.reminders.due()).resolves.toMatchObject([{ id: 81 }]);
			await expect(caller.filters.reminders.alerts()).resolves.toMatchObject([{ id: 82, alertDate: new Date("2026-08-15T09:00:00.000Z") }]);
		} finally {
			vi.useRealTimers();
		}
	});
});


describe("المخزن ومنع تكرار الأصناف", () => {
  it("يحوّل إضافة صنف موجود إلى حركة وارد ومصروف خزينة دون إنشاء بطاقة ثانية", async () => {
    const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 41, ownerId: 1, name: "فلتر جامبو" }] }) }) }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { insertCalls.push({ table, values }); return [{ insertId: table === inventoryMovements ? 91 : 0 }]; } }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());
    const result = await caller.filters.inventory.createItem({ name: "فلتر جامبو", category: "فلاتر", unit: "قطعة", reorderLevel: 2, defaultUnitCost: 1250, openingQuantity: 4, notes: "وارد جديد" });
    expect(result).toMatchObject({ id: 41, merged: true, duplicate: true, movementId: 91 });
    expect(insertCalls.filter(call => call.table === inventoryItems)).toHaveLength(0);
    expect(insertCalls.find(call => call.table === inventoryMovements)?.values).toMatchObject({ inventoryItemId: 41, movementType: "incoming", quantity: 4, unitCost: 1250 });
    expect(insertCalls.find(call => call.table === cashTransactions)?.values).toMatchObject({ amount: 5000, sourceInventoryMovementId: 91, transactionType: "expense" });
  });
});

describe("صلاحيات الفني والإدارة", () => {
  function createTechnicianContext(id = 9): TrpcContext {
    return {
      ...createContext(),
      user: { ...createContext().user!, id, role: "user" },
    };
  }

  it("يربط تسجيل زيارة الفني بمالك الشركة ومعرف حسابه المركزي", async () => {
    let storedVisit: Record<string, unknown> | undefined;
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: table === users ? () => ({ where: () => ({ limit: async () => [{ id: 9, name: "فني الاختبار", displayName: "فني الاختبار" }] }) }) : undefined,
          where: () => ({
            limit: async () => table === users
              ? [{ id: 9, role: "user", name: "فني الاختبار" }]
              : table === allowedTechnicianAccounts
                ? [{ ownerId: 1 }]
                : table === customers
                  ? [{ id: 7, ownerId: 1, name: "عميل الشركة" }]
                  : [],
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          if (table === visits) storedVisit = values;
          return [{ insertId: table === visits ? 101 : 0 }];
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createTechnicianContext());

    await expect(caller.filters.visits.create({
      customerId: 7,
      visitType: "follow_up",
      visitDate: new Date("2026-08-23T09:00:00.000Z"),
      assignedTechnicianId: 9,
      visitResult: "تمت المتابعة",
    })).resolves.toMatchObject({ id: 101, reminderCreated: false, alreadySynced: false });

    expect(storedVisit).toMatchObject({ ownerId: 1, customerId: 7, assignedTechnicianId: 9, technicianName: "فني الاختبار" });
  });

  it("يرفض إنشاء زيارة عند تمرير فني غير مرتبط بالشركة", async () => {
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: table === users ? () => ({ where: () => ({ limit: async () => [] }) }) : undefined,
          where: () => ({ limit: async () => table === customers ? [{ id: 7, ownerId: 1, name: "عميل الشركة" }] : [] }),
        }),
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.filters.visits.create({
      customerId: 7,
      visitType: "follow_up",
      visitDate: new Date("2026-08-23T09:00:00.000Z"),
      assignedTechnicianId: 999,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("يعيد أمر الشركة المسند إلى الفني في قائمة جهازه", async () => {
    const assignedOrder = {
      id: 101,
      ownerId: 1,
      customerId: 7,
      assignedTechnicianId: 9,
      technicianName: "فني الاختبار",
      visitType: "maintenance",
      visitDate: new Date("2026-08-23T09:00:00.000Z"),
      status: "assigned",
    };
    const db = {
      select: () => ({
        from: (table: unknown) => {
          if (table === visits || table === workOrderProofs) {
            return { where: () => ({ orderBy: async () => table === visits ? [assignedOrder] : [] }) };
          }
          return { where: async () => table === customers ? [{ id: 7, ownerId: 1, name: "عميل الشركة", phone: "01000000000", address: "العنوان" }] : [] };
        },
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = appRouter.createCaller(createTechnicianContext());

    await expect(caller.filters.workOrders.list()).resolves.toMatchObject([{ id: 101, assignedTechnicianId: 9, customer: { id: 7, name: "عميل الشركة" } }]);
  });

  it("يمنع الفني من تصحيح تسجيل زيارة العميل", async () => {
    const caller = appRouter.createCaller(createTechnicianContext());
    await expect(caller.filters.visits.updateDetails({
      id: 55,
      visitType: "maintenance",
      visitDate: new Date("2026-08-20T09:00:00.000Z"),
      technicianName: "فني",
      visitResult: "تصحيح ممنوع",
      notes: null,
      status: "completed",
      collectedAmount: 0,
      collectedCurrency: "SAR",
      pin: TEST_PIN,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("يمنع الفني من قراءة وتعديل المخزن والخزينة", async () => {
    const caller = appRouter.createCaller(createTechnicianContext());
    await expect(caller.filters.inventory.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.filters.cash.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.filters.inventory.createItem({ name: "صنف فني", openingQuantity: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.filters.cash.create({
      transactionType: "expense",
      amount: 1000,
      category: "مصروف",
      transactionDate: new Date("2026-08-15T09:00:00.000Z"),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
