import { describe, expect, it } from "vitest";
import { alertDateForReminder, calculateStockBalance, customerCode, followUpDate, followUpSummaryFromVisits, isAlertReady, isReminderAlertActive, mergeDashboardReminderAlerts, needsAutomaticReminder } from "../shared/filterBusiness";

describe("منطق تطبيق فلاتر المياه", () => {
  it("ينشئ موعد المتابعة بعد 120 يومًا من تاريخ الزيارة افتراضيًا", () => {
    const visitDate = new Date("2026-01-01T00:00:00.000Z");
    expect(followUpDate(visitDate).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("يسمح بمدة متابعة مخصصة أثناء تسجيل الزيارة", () => {
    const visitDate = new Date("2026-01-01T00:00:00.000Z");
    expect(followUpDate(visitDate, 60).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("يستخدم 120 يوماً تلقائياً عند ترك مدة المتابعة غير محددة", () => {
    const visitDate = new Date("2026-01-01T00:00:00.000Z");
    expect(followUpDate(visitDate, undefined).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("يُنشئ تذكيرًا للتركيب والصيانة فقط", () => {
    expect(needsAutomaticReminder("installation")).toBe(true);
    expect(needsAutomaticReminder("maintenance")).toBe(true);
    expect(needsAutomaticReminder("cartridge_change")).toBe(false);
  });

  it("يستخلص آخر تركيب أو صيانة ليحدّث الموعد القادم والأيام المتبقية وكود العميل", () => {
    const summary = followUpSummaryFromVisits([
      { visitType: "installation" as const, visitDate: new Date("2026-01-01T09:00:00.000Z") },
      { visitType: "cartridge_change" as const, visitDate: new Date("2026-02-15T09:00:00.000Z") },
      { visitType: "maintenance" as const, visitDate: new Date("2026-03-01T09:00:00.000Z") },
    ], new Date("2026-06-19T09:00:00.000Z"));

    expect(customerCode(7)).toBe("٧");
    expect(customerCode(1000000)).toBe("١٠٠٠٠٠٠");
    expect(summary).toMatchObject({
      lastServiceVisitType: "maintenance",
      lastServiceVisitDate: new Date("2026-03-01T09:00:00.000Z"),
      nextVisitDate: new Date("2026-06-29T09:00:00.000Z"),
      followUpDays: 120,
      daysRemaining: 10,
    });
  });

  it("يحسب عدد الأيام المخصص من تاريخ الزيارة إلى الموعد المحفوظ", () => {
    const summary = followUpSummaryFromVisits([
      { visitType: "maintenance" as const, visitDate: new Date("2026-01-01T09:00:00.000Z"), status: "assigned", nextVisitDate: new Date("2026-03-02T09:00:00.000Z") },
    ]);
    expect(summary).toMatchObject({ followUpDays: 60, nextVisitDate: new Date("2026-03-02T09:00:00.000Z") });
  });

  it("يتجاهل الزيارة غير المكتملة عند إكمال تاريخ المتابعة تلقائيًا", () => {
    const summary = followUpSummaryFromVisits([
      { visitType: "maintenance" as const, visitDate: new Date("2026-01-01T09:00:00.000Z"), status: "completed" },
      { visitType: "installation" as const, visitDate: new Date("2026-03-01T09:00:00.000Z"), status: "cancelled" },
    ], new Date("2026-05-01T09:00:00.000Z"));

    expect(summary?.lastServiceVisitDate).toEqual(new Date("2026-01-01T09:00:00.000Z"));
    expect(summary?.daysRemaining).toBe(0);
  });

  it("يعرض التسلسل من ١ حتى ١٠٠٠ بالأرقام العربية الهندية دون بادئة", () => {
    expect([1, 2, 3, 1000].map(customerCode)).toEqual(["١", "٢", "٣", "١٠٠٠"]);
  });

  it("يحسب رصيد المخزنة من الرصيد الافتتاحي وحركة الوارد والمنصرف", () => {
    expect(calculateStockBalance(12, [
      { movementType: "incoming", quantity: 5 },
      { movementType: "outgoing", quantity: 4 },
    ])).toBe(13);
  });

  it("يكشف أن الرصيد لا يكفي لصرف كمية أكبر من المتاح", () => {
    const balance = calculateStockBalance(3, [{ movementType: "outgoing", quantity: 1 }]);
    expect(5 > balance).toBe(true);
  });

  it("يبدأ التنبيه قبل الموعد بيوم عند الساعة التاسعة صباحًا بالتوقيت المضبوط ويظل جاهزًا حتى إنهاء التذكير", () => {
    const settings = { leadDays: 1, alertHour: 9, alertMinute: 0, timezoneOffsetMinutes: 180 };
    const reminderDate = new Date("2026-05-10T21:00:00.000Z"); // 11 مايو، 00:00 بالتوقيت المحلي +03:00
    const alertDate = alertDateForReminder(reminderDate, settings);

    expect(alertDate.toISOString()).toBe("2026-05-10T06:00:00.000Z");
    expect(isAlertReady(reminderDate, settings, new Date("2026-05-10T05:59:59.000Z"))).toBe(false);
    expect(isAlertReady(reminderDate, settings, new Date("2026-05-10T06:00:00.000Z"))).toBe(true);
    expect(isAlertReady(reminderDate, settings, new Date("2026-05-12T18:00:00.000Z"))).toBe(true);
  });

  it("ينهي التنبيه عند نهاية اليوم التالي للموعد إذا لم تُسجل زيارة", () => {
    const settings = { leadDays: 1, alertHour: 9, alertMinute: 0, timezoneOffsetMinutes: 180 };
    const reminderDate = new Date("2026-05-10T21:00:00.000Z"); // 11 مايو بالتوقيت المحلي

    expect(isReminderAlertActive(reminderDate, settings, new Date("2026-05-12T20:59:59.000Z"))).toBe(true);
    expect(isReminderAlertActive(reminderDate, settings, new Date("2026-05-12T21:00:00.000Z"))).toBe(false);
  });

  it("يدمج التذكيرات المستحقة والقريبة دون تكرار ويرتبها حسب أقرب موعد", () => {
    const due = { id: 2, reminderDate: new Date("2026-08-15T06:00:00.000Z") };
    const upcoming = { id: 3, reminderDate: new Date("2026-08-16T06:00:00.000Z") };

    expect(mergeDashboardReminderAlerts([due], [upcoming, due])).toEqual([
      { reminder: due, isDue: true },
      { reminder: upcoming, isDue: false },
    ]);
  });
});
