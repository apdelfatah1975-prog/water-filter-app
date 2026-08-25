import { afterEach, describe, expect, it } from "vitest";
import { defaultAppSettings, formatAppMoney, getAppSettings, resetAppSettings, saveAppSettings } from "./appSettings";

describe("إعدادات التطبيق المحلية", () => {
  afterEach(() => localStorage.clear());

  it("تحفظ التغييرات وتدمجها مع القيم الافتراضية", () => {
    saveAppSettings({ companyName: "شركة اختبار", followUpDays: 90, dashboardShowCash: false });
    expect(getAppSettings()).toMatchObject({ companyName: "شركة اختبار", followUpDays: 120, dashboardShowCash: false, currencyLabel: "" });
  });

  it("تحفظ حجم الخط المختار وتستخدم المتوسط افتراضيًا", () => {
    expect(defaultAppSettings.fontSize).toBe("medium");
    saveAppSettings({ fontSize: "large" });
    expect(getAppSettings().fontSize).toBe("large");
  });

  it("تعيد الإعدادات الافتراضية دون حذف بيانات التطبيق الأخرى", () => {
    localStorage.setItem("purepoint-offline-customers", "[]");
    saveAppSettings({ compactTables: true });
    expect(resetAppSettings()).toEqual(defaultAppSettings);
    expect(localStorage.getItem("purepoint-offline-customers")).toBe("[]");
  });

  it("تعرض المبلغ كرقم فقط دون رمز عملة", () => {
    const formatted = formatAppMoney(250, { ...defaultAppSettings, currencyLabel: "" });
    expect(formatted).toContain("٢٥٠");
    expect(formatted).not.toContain("ر.س");
    expect(formatted).not.toContain("ريال");
  });

  it("لا تضيف أصفارًا أو منازل عشرية للمبالغ المسجلة كوحدات كاملة", () => {
    expect(formatAppMoney(250)).toContain("٢٥٠");
    expect(formatAppMoney(250)).not.toContain("٫");
    expect(formatAppMoney(250)).not.toContain("٫٠");
    expect(formatAppMoney(2.5)).toContain("٣");
  });
});
