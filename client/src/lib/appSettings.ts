export const APP_SETTINGS_KEY = "purepoint-app-settings";

import { FOLLOW_UP_DAYS } from "@shared/filterBusiness";

export type SalesAgentCommissionMode = "per_filter" | "per_group";
export type SalesAgentProfile = { phone?: string; commissionMode: SalesAgentCommissionMode; commissionValue: number; filtersPerGroup: number };

export type AppSettings = {
  companyName: string;
  companyPhone: string;
  companyAddress: string;
  defaultTechnician: string;
  followUpDays: number;
  reminderLeadDays: number;
  reminderHour: number;
  reminderMinute: number;
  remindersEnabled: boolean;
  reminderSoundEnabled: boolean;
  reminderKeepVisibleNextDay: boolean;
  currencyLabel: string;
  dateFormat: "arabic" | "gregorian";
  useArabicDigits: boolean;
  dashboardShowUpcoming: boolean;
  dashboardShowDue: boolean;
  dashboardShowCash: boolean;
  dashboardShowInventory: boolean;
  customerCodeMode: "automatic" | "manual";
  defaultVisitType: "installation" | "maintenance" | "cartridge_change" | "follow_up" | "other";
  autoSaveLocally: boolean;
  syncWhenOnline: boolean;
  backupReminderDays: number;
  confirmDestructiveActions: boolean;
  compactTables: boolean;
  compactCustomersOnMobile: boolean;
  compactVisitsOnMobile: boolean;
  technicianPayroll: Record<string, { monthlySalary: number; installationPercent: number; maintenancePercent: number; phone?: string }>;
  salesAgents: Record<string, SalesAgentProfile>;
};

export const defaultAppSettings: AppSettings = {
  companyName: "نقطة نقاء",
  companyPhone: "",
  companyAddress: "",
  defaultTechnician: "",
  followUpDays: 120,
  reminderLeadDays: 1,
  reminderHour: 9,
  reminderMinute: 0,
  remindersEnabled: true,
  reminderSoundEnabled: true,
  reminderKeepVisibleNextDay: true,
  currencyLabel: "",
  dateFormat: "arabic",
  useArabicDigits: true,
  dashboardShowUpcoming: true,
  dashboardShowDue: true,
  dashboardShowCash: true,
  dashboardShowInventory: true,
  customerCodeMode: "automatic",
  defaultVisitType: "installation",
  autoSaveLocally: true,
  syncWhenOnline: true,
  backupReminderDays: 7,
  confirmDestructiveActions: true,
  compactTables: false,
  compactCustomersOnMobile: false,
  compactVisitsOnMobile: false,
  technicianPayroll: {},
  salesAgents: {},
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getAppSettings(): AppSettings {
  if (!canUseStorage()) return { ...defaultAppSettings };
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return { ...defaultAppSettings };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...defaultAppSettings, ...parsed, followUpDays: FOLLOW_UP_DAYS };
  } catch {
    return { ...defaultAppSettings };
  }
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getAppSettings(), ...patch, followUpDays: FOLLOW_UP_DAYS };
  if (canUseStorage()) localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("purepoint-settings-changed", { detail: next }));
  return next;
}

export function resetAppSettings(): AppSettings {
  if (canUseStorage()) localStorage.removeItem(APP_SETTINGS_KEY);
  const next = { ...defaultAppSettings };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("purepoint-settings-changed", { detail: next }));
  return next;
}

export function formatAppMoney(amount: number, settings = getAppSettings()) {
  void settings;
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0, minimumFractionDigits: 0, useGrouping: true }).format(Math.round(safeAmount));
}

export function formatAppDate(value: string | Date, settings = getAppSettings()) {
  return new Intl.DateTimeFormat(settings.dateFormat === "arabic" ? "ar-SA" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
}
