export const FOLLOW_UP_DAYS = 120;
export const DEFAULT_ALERT_LEAD_DAYS = 1;
export const DEFAULT_ALERT_HOUR = 9;
export const DEFAULT_ALERT_MINUTE = 0;
export const DEFAULT_TIMEZONE_OFFSET_MINUTES = 180;

export const visitTypes = [
  "installation",
  "maintenance",
  "cartridge_change",
  "follow_up",
  "other",
] as const;

export type VisitType = (typeof visitTypes)[number];

export function needsAutomaticReminder(visitType: VisitType) {
  return visitType === "installation" || visitType === "maintenance";
}

export function followUpDate(visitDate: Date, followUpDays = FOLLOW_UP_DAYS) {
  const safeDays = Number.isFinite(followUpDays) && followUpDays >= 0 ? Math.floor(followUpDays) : FOLLOW_UP_DAYS;
  const dueDate = new Date(visitDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + safeDays);
  return dueDate;
}

export function customerCode(customerId: number) {
  return String(customerId).replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

export type FollowUpSourceVisit = {
  visitDate: Date;
  visitType: VisitType;
  status?: string | null;
  /** الموعد الذي اختاره المستخدم أو حسبه النظام عند تسجيل الخدمة. */
  nextVisitDate?: Date | null;
};

export function daysUntilFollowUp(followUp: Date, now = new Date()) {
  return Math.ceil((followUp.getTime() - now.getTime()) / 86_400_000);
}

export function followUpSummaryFromVisits<T extends FollowUpSourceVisit>(visits: T[], now = new Date()) {
  const lastServiceVisit = visits
    .filter(visit => {
      if (!needsAutomaticReminder(visit.visitType) || visit.status === "cancelled") return false;
      // الزيارة المسجلة من شاشة العملاء تحفظ nextVisitDate حتى قبل إكمالها.
      // أما أمر العمل القديم بحالة assigned ومن دون موعد محفوظ فلا يُعد خدمة منفذة.
      return Boolean(visit.nextVisitDate) || !visit.status || visit.status === "completed";
    })
    .sort((first, second) => second.visitDate.getTime() - first.visitDate.getTime())[0];

  if (!lastServiceVisit) return null;

  const nextVisitDate = lastServiceVisit.nextVisitDate ?? followUpDate(lastServiceVisit.visitDate);
  const followUpDays = Math.max(0, Math.round((nextVisitDate.getTime() - lastServiceVisit.visitDate.getTime()) / 86_400_000));
  return {
    lastServiceVisitDate: lastServiceVisit.visitDate,
    lastServiceVisitType: lastServiceVisit.visitType,
    nextVisitDate,
    followUpDays,
    daysRemaining: daysUntilFollowUp(nextVisitDate, now),
  };
}

export type ReminderAlertSettings = {
  leadDays: number;
  alertHour: number;
  alertMinute: number;
  timezoneOffsetMinutes: number;
};

export function alertDateForReminder(reminderDate: Date, settings: ReminderAlertSettings) {
  const localDue = new Date(reminderDate.getTime() + settings.timezoneOffsetMinutes * 60_000);
  const localAlertUtcMillis = Date.UTC(
    localDue.getUTCFullYear(),
    localDue.getUTCMonth(),
    localDue.getUTCDate() - settings.leadDays,
    settings.alertHour,
    settings.alertMinute,
    0,
    0,
  );
  return new Date(localAlertUtcMillis - settings.timezoneOffsetMinutes * 60_000);
}

export function isAlertReady(reminderDate: Date, settings: ReminderAlertSettings, now = new Date()) {
  return alertDateForReminder(reminderDate, settings).getTime() <= now.getTime();
}

export function isReminderAlertActive(reminderDate: Date, settings: ReminderAlertSettings, now = new Date()) {
  if (!isAlertReady(reminderDate, settings, now)) return false;
  const localDue = new Date(reminderDate.getTime() + settings.timezoneOffsetMinutes * 60_000);
  const endOfNextLocalDay = Date.UTC(
    localDue.getUTCFullYear(),
    localDue.getUTCMonth(),
    localDue.getUTCDate() + 2,
    0,
    0,
    0,
    0,
  ) - settings.timezoneOffsetMinutes * 60_000;
  return now.getTime() < endOfNextLocalDay;
}

export function mergeDashboardReminderAlerts<T extends { id: number; reminderDate: Date }>(
  dueReminders: T[],
  upcomingAlerts: T[],
) {
  const dueIds = new Set(dueReminders.map(reminder => reminder.id));
  const reminders = new Map<number, T>();
  [...dueReminders, ...upcomingAlerts].forEach(reminder => reminders.set(reminder.id, reminder));

  return Array.from(reminders.values())
    .sort((first, second) => first.reminderDate.getTime() - second.reminderDate.getTime())
    .map(reminder => ({ reminder, isDue: dueIds.has(reminder.id) }));
}

export function calculateStockBalance(
  openingQuantity: number,
  movements: Array<{ movementType: "incoming" | "outgoing"; quantity: number }>,
) {
  return movements.reduce(
    (balance, movement) =>
      movement.movementType === "incoming"
        ? balance + movement.quantity
        : balance - movement.quantity,
    openingQuantity,
  );
}
