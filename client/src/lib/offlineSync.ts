const SESSION_KEY = "purepoint-offline-session";
import * as XLSX from "xlsx";
import { extractArray } from "@/lib/dataNormalization";

const CUSTOMERS_KEY = "purepoint-offline-customers";
const VISITS_KEY = "purepoint-offline-visits";
const CUSTOMER_QUEUE_PREFIX = "purepoint-pending-customers";
const VISIT_QUEUE_PREFIX = "purepoint-pending-visits";
const VISIT_DELETE_QUEUE_PREFIX = "purepoint-pending-visit-deletes";
const WORK_ORDER_QUEUE_PREFIX = "purepoint-pending-work-orders";
const WORK_ORDER_PROOF_QUEUE_PREFIX = "purepoint-pending-work-order-proofs";
const DASHBOARD_KEY = "purepoint-offline-dashboard";
const CASH_KEY_PREFIX = "purepoint-offline-cash";
const INVENTORY_KEY_PREFIX = "purepoint-offline-inventory";
const CASH_QUEUE_PREFIX = "purepoint-pending-cash";
const INVENTORY_QUEUE_PREFIX = "purepoint-pending-inventory";
const REPORT_KEY_PREFIX = "purepoint-offline-report";
const SERVICE_CATALOG_KEY = "purepoint-offline-service-catalog";
const REMINDERS_KEY = "purepoint-offline-reminders";
const WORK_ORDERS_KEY = "purepoint-offline-work-orders";

export type OfflineCustomer = {
  id: number;
  manualCode?: string | null;
  name: string;
  phone: string;
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  notes?: string | null;
};

export type PendingCustomer = Omit<OfflineCustomer, "id"> & {
  firstVisitType?: PendingVisit["visitType"];
  firstVisitDate?: string;
  firstTechnicianName?: string | null;
  firstSalesAgentName?: string | null;
  firstFilterCount?: number;
  firstVisitNotes?: string | null;
  firstVisitResult?: string | null;
  firstCollectedAmount?: number;
  firstCollectedCurrency?: "SAR";
  firstVisitItems?: OfflineVisitItem[];
  localId: number;
  clientOperationId: string;
  createdAt: string;
};

export type OfflineServiceCatalog = {
  types: Array<{ id: number; code: string; name: string }>;
  mappings: Array<{ serviceTypeId: number; inventoryItemId: number; defaultQuantity: number; isRequired: boolean; allowEditQuantity: boolean }>;
  items: Array<{ id: number; name: string; unit: string; currentBalance: number }>;
};

export type OfflineVisitItem = {
  inventoryItemId: number;
  quantity: number;
  source: "default" | "manual";
};

export type OfflineVisit = {
  id: number;
  customerId: number;
  visitType: "installation" | "maintenance" | "cartridge_change" | "follow_up" | "other";
  visitDate: string;
  technicianName?: string | null;
  salesAgentName?: string | null;
  filterCount?: number;
  tdsIn?: number | null;
  tdsOut?: number | null;
  visitResult?: string | null;
  notes?: string | null;
  collectedAmount?: number;
  collectedCurrency?: "SAR";
  items?: OfflineVisitItem[];
};

export type PendingWorkOrderProof = {
  clientOperationId: string;
  visitId: number;
  kind: "photo" | "signature" | "audio";
  dataUrl: string;
  createdAt: string;
};

export type PendingWorkOrderUpdate = {
  clientOperationId: string;
  id: number;
  status: "assigned" | "en_route" | "arrived" | "in_progress" | "completed" | "postponed" | "cancelled";
  visitResult?: string | null;
  notes?: string | null;
  executionOutcome?: "completed" | "not_completed" | null;
  notCompletedReason?: string | null;
  collectedAmount?: number;
  collectedCurrency?: "SAR";
  nextVisitDate?: string | null;
  followUpDays?: number | null;
  items?: OfflineVisitItem[];
  createdAt: string;
};

export type PendingVisit = {
  clientOperationId: string;
  customerId: number;
  visitType: "installation" | "maintenance" | "cartridge_change" | "follow_up" | "other";
  visitDate: string;
  technicianName?: string | null;
  salesAgentName?: string | null;
  filterCount?: number;
  tdsIn?: number | null;
  tdsOut?: number | null;
  visitResult?: string | null;
  notes: string | null;
  collectedAmount?: number;
  collectedCurrency?: "SAR";
  items?: OfflineVisitItem[];
  createdAt: string;
};

export type PendingCashTransaction = {
  entity?: "cash";
  clientOperationId: string;
  transactionType: "income" | "expense";
  currency: "SAR";
  amount: number;
  category: string;
  transactionDate: string;
  recipientName?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type PendingCashDelete = PendingOfflineDelete & { entity: "cash" };

export type PendingInventoryItem = {
  entity: "item";
  localId: number;
  clientOperationId: string;
  name: string;
  category?: string;
  unit?: string;
  reorderLevel?: number;
  defaultUnitCost?: number;
  openingQuantity: number;
  notes?: string | null;
  createdAt: string;
};

export type PendingInventoryMovement = {
  entity: "movement";
  clientOperationId: string;
  inventoryItemId: number;
  movementType: "incoming" | "outgoing";
  quantity: number;
  unitCost: number;
  currency: "SAR";
  movementDate: string;
  technicianName?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type PendingOfflineDelete = {
  clientOperationId: string;
  entity: "cash" | "inventoryItem" | "inventoryMovement" | "visit";
  id: number;
  pin: string;
  createdAt: string;
};

export type OfflineUser = {
  id: number;
  name: string | null;
  email: string | null;
  openId: string;
  role: "admin" | "user";
};

function available() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!available()) return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!available()) return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event("purepoint-offline-queue-changed"));
}

function queueKey(prefix: string, ownerId: number) {
  return `${prefix}-${ownerId}`;
}

function ownerDataKey(prefix: string, ownerId: number) {
  return `${prefix}-${ownerId}`;
}

function newOperationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function rememberOfflineSession(user: OfflineUser | null | undefined) {
  if (!user) return;
  writeJson(SESSION_KEY, { id: user.id, name: user.name, email: user.email, openId: user.openId, role: user.role });
}

export function getOfflineSession() {
  return readJson<OfflineUser | null>(SESSION_KEY, null);
}

export function clearOfflineState() {
  if (!available()) return;
  const session = getOfflineSession();
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CUSTOMERS_KEY);
  localStorage.removeItem(VISITS_KEY);
  if (session) {
    localStorage.removeItem(queueKey(CUSTOMER_QUEUE_PREFIX, session.id));
    localStorage.removeItem(queueKey(VISIT_QUEUE_PREFIX, session.id));
    localStorage.removeItem(queueKey(WORK_ORDER_QUEUE_PREFIX, session.id));
  }
}

export function cacheOfflineCustomers(customers: OfflineCustomer[]) {
  const safeCustomers = Array.isArray(customers) ? customers : [];
  writeJson(CUSTOMERS_KEY, safeCustomers.map(({ id, manualCode, name, phone, address, latitude, longitude, notes }) => ({ id, manualCode, name, phone, address, latitude, longitude, notes })));
}

export function getOfflineCustomers(): OfflineCustomer[] {
  const cached = readJson<unknown>(CUSTOMERS_KEY, []);
  return Array.isArray(cached) ? cached as OfflineCustomer[] : [];
}

export function cacheOfflineServiceCatalog(catalog: OfflineServiceCatalog) {
  writeJson(SERVICE_CATALOG_KEY, catalog);
}

export function getOfflineServiceCatalog() {
  return readJson<OfflineServiceCatalog | null>(SERVICE_CATALOG_KEY, null);
}

const OFFLINE_LIST_FIELDS = [
  "customers", "technicians", "orders", "due", "alerts", "transactions", "items", "movements",
  "visits", "reminders", "serviceTypes", "availableCategories", "availableTechnicians", "availableItemNames",
] as const;

function normalizeCachedSnapshot<T>(value: unknown): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = { ...(value as Record<string, unknown>) };
  for (const field of OFFLINE_LIST_FIELDS) {
    if (field in snapshot && !Array.isArray(snapshot[field])) snapshot[field] = [];
  }
  return snapshot as T;
}

function normalizeCachedList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function cacheOfflineReminders<T>(value: T) {
  writeJson(REMINDERS_KEY, normalizeCachedSnapshot<T>(value));
}

export function getOfflineReminders<T>() {
  return normalizeCachedSnapshot<T>(readJson<unknown>(REMINDERS_KEY, null));
}

export function cacheOfflineWorkOrders<T>(value: T) {
  writeJson(WORK_ORDERS_KEY, normalizeCachedSnapshot<T>(value));
}

export function getOfflineWorkOrders<T>() {
  return normalizeCachedSnapshot<T>(readJson<unknown>(WORK_ORDERS_KEY, null));
}

export function cacheOfflineVisits(visits: OfflineVisit[]) {
  writeJson(VISITS_KEY, normalizeCachedList<OfflineVisit>(visits));
}

export function getOfflineVisits() {
  return normalizeCachedList<OfflineVisit>(readJson<unknown>(VISITS_KEY, []));
}

export function cacheOfflineDashboard<T>(dashboard: T) {
  writeJson(DASHBOARD_KEY, normalizeCachedSnapshot<T>(dashboard));
}

export function getOfflineDashboard<T>() {
  return normalizeCachedSnapshot<T>(readJson<unknown>(DASHBOARD_KEY, null));
}

export function getPendingCustomers(ownerId: number) {
  return extractArray<PendingCustomer>(readJson<unknown>(queueKey(CUSTOMER_QUEUE_PREFIX, ownerId), []));
}

function normalizeCustomerName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

export function hasOfflineCustomerName(name: string, excludeId?: number) {
  const normalizedName = normalizeCustomerName(name);
  return getOfflineCustomers().some(customer => customer.id !== excludeId && normalizeCustomerName(customer.name) === normalizedName)
    || getPendingCustomers(getOfflineSession()?.id ?? 0).some(customer => customer.localId !== excludeId && normalizeCustomerName(customer.name) === normalizedName);
}

export function queueOfflineCustomer(ownerId: number, customer: Omit<OfflineCustomer, "id"> & Partial<Omit<PendingCustomer, "localId" | "clientOperationId" | "createdAt">>) {
  if (hasOfflineCustomerName(customer.name)) throw new Error("اسم العميل موجود بالفعل، استخدم اسمًا مختلفًا.");
  const pending: PendingCustomer = {
    ...customer,
    localId: -Date.now(),
    clientOperationId: newOperationId(),
    createdAt: new Date().toISOString(),
  };
  writeJson(queueKey(CUSTOMER_QUEUE_PREFIX, ownerId), [...getPendingCustomers(ownerId), pending]);
  cacheOfflineCustomers([...getOfflineCustomers(), { ...customer, id: pending.localId }]);
  return pending;
}

export function removePendingCustomer(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(CUSTOMER_QUEUE_PREFIX, ownerId), getPendingCustomers(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function replaceOfflineCustomerId(localId: number, serverId: number) {
  writeJson(CUSTOMERS_KEY, getOfflineCustomers().map(customer => customer.id === localId ? { ...customer, id: serverId } : customer));
}

export function getPendingVisits(ownerId: number) {
  return extractArray<PendingVisit>(readJson<unknown>(queueKey(VISIT_QUEUE_PREFIX, ownerId), []));
}

export function queueOfflineVisit(ownerId: number, visit: Omit<PendingVisit, "clientOperationId" | "createdAt">) {
  const pending: PendingVisit = { ...visit, clientOperationId: newOperationId(), createdAt: new Date().toISOString() };
  writeJson(queueKey(VISIT_QUEUE_PREFIX, ownerId), [...getPendingVisits(ownerId), pending]);
  return pending;
}

export function removePendingVisit(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(VISIT_QUEUE_PREFIX, ownerId), getPendingVisits(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function getPendingWorkOrderUpdates(ownerId: number) {
  return extractArray<PendingWorkOrderUpdate>(readJson<unknown>(queueKey(WORK_ORDER_QUEUE_PREFIX, ownerId), []));
}

export function queueOfflineWorkOrderUpdate(ownerId: number, input: Omit<PendingWorkOrderUpdate, "clientOperationId" | "createdAt">) {
  const pending: PendingWorkOrderUpdate = { ...input, clientOperationId: newOperationId(), createdAt: new Date().toISOString() };
  writeJson(queueKey(WORK_ORDER_QUEUE_PREFIX, ownerId), [...getPendingWorkOrderUpdates(ownerId), pending]);
  return pending;
}

export function removePendingWorkOrderUpdate(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(WORK_ORDER_QUEUE_PREFIX, ownerId), getPendingWorkOrderUpdates(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function getPendingWorkOrderProofs(ownerId: number) {
  return extractArray<PendingWorkOrderProof>(readJson<unknown>(queueKey(WORK_ORDER_PROOF_QUEUE_PREFIX, ownerId), []));
}

export function queueOfflineWorkOrderProof(ownerId: number, input: Omit<PendingWorkOrderProof, "clientOperationId" | "createdAt">) {
  const pending: PendingWorkOrderProof = { ...input, clientOperationId: newOperationId(), createdAt: new Date().toISOString() };
  writeJson(queueKey(WORK_ORDER_PROOF_QUEUE_PREFIX, ownerId), [...getPendingWorkOrderProofs(ownerId), pending]);
  return pending;
}

export function removePendingWorkOrderProof(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(WORK_ORDER_PROOF_QUEUE_PREFIX, ownerId), getPendingWorkOrderProofs(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function cacheOfflineReport<T>(ownerId: number, dateFrom: string, dateTo: string, value: T) {
  writeJson(`${REPORT_KEY_PREFIX}-${ownerId}-${dateFrom}-${dateTo}`, normalizeCachedSnapshot<T>(value));
}

export function getOfflineReport<T>(ownerId: number, dateFrom: string, dateTo: string) {
  return normalizeCachedSnapshot<T>(readJson<unknown>(`${REPORT_KEY_PREFIX}-${ownerId}-${dateFrom}-${dateTo}`, null));
}

export function getLatestOfflineReport<T extends { period?: { dateFrom?: string; dateTo?: string } }>(ownerId: number) {
  if (!available()) return null;
  let latest: T | null = null;
  let latestDate = "";
  const prefix = `${REPORT_KEY_PREFIX}-${ownerId}-`;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const value = readJson<T | null>(key, null);
    const dateTo = value?.period?.dateTo ?? "";
    if (value && dateTo >= latestDate) {
      latest = value;
      latestDate = dateTo;
    }
  }
  return latest;
}

export function cacheOfflineCash<T>(ownerId: number, value: T) {
  writeJson(ownerDataKey(CASH_KEY_PREFIX, ownerId), normalizeCachedSnapshot<T>(value));
}

export function getOfflineCash<T>(ownerId: number) {
  return normalizeCachedSnapshot<T>(readJson<unknown>(ownerDataKey(CASH_KEY_PREFIX, ownerId), null));
}

export function cacheOfflineInventory<T>(ownerId: number, value: T) {
  writeJson(ownerDataKey(INVENTORY_KEY_PREFIX, ownerId), normalizeCachedSnapshot<T>(value));
}

export function getOfflineInventory<T>(ownerId: number) {
  return normalizeCachedSnapshot<T>(readJson<unknown>(ownerDataKey(INVENTORY_KEY_PREFIX, ownerId), null));
}

export function getPendingVisitDeletes(ownerId: number) {
  return extractArray<PendingOfflineDelete>(readJson<unknown>(queueKey(VISIT_DELETE_QUEUE_PREFIX, ownerId), []));
}

export function removePendingVisitDelete(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(VISIT_DELETE_QUEUE_PREFIX, ownerId), getPendingVisitDeletes(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function getPendingCash(ownerId: number) {
  return extractArray<PendingCashTransaction | PendingOfflineDelete>(readJson<unknown>(queueKey(CASH_QUEUE_PREFIX, ownerId), []));
}

export function queueOfflineCash(ownerId: number, input: Omit<PendingCashTransaction, "clientOperationId" | "createdAt" | "entity">) {
  const pending = { ...input, clientOperationId: newOperationId(), createdAt: new Date().toISOString() };
  writeJson(queueKey(CASH_QUEUE_PREFIX, ownerId), [...getPendingCash(ownerId), pending]);
  return pending;
}

export function removePendingCash(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(CASH_QUEUE_PREFIX, ownerId), getPendingCash(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function getPendingInventory(ownerId: number) {
  return extractArray<PendingInventoryItem | PendingInventoryMovement | PendingOfflineDelete>(readJson<unknown>(queueKey(INVENTORY_QUEUE_PREFIX, ownerId), []));
}

export function queueOfflineInventoryItem(ownerId: number, input: Omit<PendingInventoryItem, "clientOperationId" | "createdAt" | "entity" | "localId">) {
  const pending = { ...input, localId: -Date.now(), clientOperationId: newOperationId(), createdAt: new Date().toISOString(), entity: "item" as const };
  writeJson(queueKey(INVENTORY_QUEUE_PREFIX, ownerId), [...getPendingInventory(ownerId), pending]);
  return pending;
}

export function queueOfflineInventoryMovement(ownerId: number, input: Omit<PendingInventoryMovement, "clientOperationId" | "createdAt" | "entity">) {
  const pending = { ...input, clientOperationId: newOperationId(), createdAt: new Date().toISOString(), entity: "movement" as const };
  writeJson(queueKey(INVENTORY_QUEUE_PREFIX, ownerId), [...getPendingInventory(ownerId), pending]);
  return pending;
}

export function queueOfflineDelete(ownerId: number, input: Omit<PendingOfflineDelete, "clientOperationId" | "createdAt">) {
  const pending = { ...input, clientOperationId: newOperationId(), createdAt: new Date().toISOString() };
  if (input.entity === "visit") {
    writeJson(queueKey(VISIT_DELETE_QUEUE_PREFIX, ownerId), [...getPendingVisitDeletes(ownerId), pending]);
  } else {
    const prefix = input.entity === "cash" ? CASH_QUEUE_PREFIX : INVENTORY_QUEUE_PREFIX;
    writeJson(queueKey(prefix, ownerId), [...(input.entity === "cash" ? getPendingCash(ownerId) : getPendingInventory(ownerId)), pending]);
  }
  return pending;
}

export function removePendingInventory(ownerId: number, clientOperationId: string) {
  writeJson(queueKey(INVENTORY_QUEUE_PREFIX, ownerId), getPendingInventory(ownerId).filter(item => item.clientOperationId !== clientOperationId));
}

export function getPendingOperationCount(ownerId: number) {
  return getPendingCustomers(ownerId).length + getPendingVisits(ownerId).length + getPendingVisitDeletes(ownerId).length + getPendingWorkOrderUpdates(ownerId).length + getPendingWorkOrderProofs(ownerId).length + getPendingCash(ownerId).length + getPendingInventory(ownerId).length;
}

export type OfflineBackup = {
  format: "purepoint-offline-backup";
  version: 1;
  exportedAt: string;
  app: "نقطة نقاء";
  storage: Record<string, unknown>;
};

export function createOfflineBackup(now = new Date()): OfflineBackup {
  const storage: Record<string, unknown> = {};
  if (available()) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("purepoint-")) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        storage[key] = JSON.parse(raw);
      } catch {
        storage[key] = raw;
      }
    }
  }
  return {
    format: "purepoint-offline-backup",
    version: 1,
    exportedAt: now.toISOString(),
    app: "نقطة نقاء",
    storage,
  };
}

function serializeStoredValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

const arabicFieldLabels: Record<string, string> = {
  id: "المعرّف", ownerId: "معرّف المستخدم", customerId: "معرّف العميل", inventoryItemId: "معرّف الصنف", manualCode: "كود العميل", customerCode: "كود العميل", localId: "المعرّف المحلي", clientOperationId: "معرّف العملية المحلية",
  name: "الاسم", phone: "الهاتف", address: "العنوان", location: "الموقع", latitude: "خط العرض", longitude: "خط الطول", notes: "الملاحظات",
  visitType: "نوع الزيارة", serviceOrderType: "نوع أمر الخدمة", visitDate: "تاريخ الزيارة", nextVisitDate: "موعد الزيارة القادمة", reminderDate: "تاريخ التذكير", reminderId: "معرّف التذكير", alertedAt: "وقت التنبيه", status: "الحالة",
  technicianName: "اسم الفني", firstTechnicianName: "اسم فني الزيارة الأولى", visitResult: "نتيجة الزيارة", firstVisitResult: "نتيجة الزيارة الأولى", recipientName: "اسم المستلم", receivedBy: "الفني المستلم",
  collectedAmount: "المبلغ المحصل", firstCollectedAmount: "مبلغ الزيارة الأولى", amount: "المبلغ", currency: "العملة", category: "البند", description: "البيان", transactionType: "نوع العملية", transactionDate: "تاريخ العملية",
  date: "التاريخ", dateFrom: "من تاريخ", dateTo: "إلى تاريخ", period: "الفترة", itemId: "معرّف الصنف", itemName: "اسم الصنف", quantity: "الكمية", openingQuantity: "الرصيد الافتتاحي", currentBalance: "الرصيد الحالي", incoming: "الوارد", outgoing: "المنصرف", movementType: "نوع الحركة", movementDate: "تاريخ الحركة", unitCost: "سعر الوحدة", unitPrice: "سعر الوحدة", total: "الإجمالي",
  createdAt: "تاريخ الإنشاء", updatedAt: "آخر تحديث", pendingOperations: "العمليات المعلقة", data: "البيانات", entity: "نوع السجل", leadDays: "عدد أيام التنبيه", alertHour: "ساعة التنبيه", alertMinute: "دقيقة التنبيه", timezoneOffsetMinutes: "فرق التوقيت بالدقائق", scheduleCronTaskUid: "معرّف الجدولة", pinHash: "رمز الحماية المشفّر",
};

function localizeReadableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localizeReadableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested], index) => [arabicFieldLabels[key] ?? `حقل إضافي ${index + 1}`, localizeReadableValue(nested)]));
}

function readableRecordRow(key: string, record: unknown, index: number): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "مفتاح البيانات": key,
    "رقم السجل": index + 1,
  };
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    base["القيمة"] = typeof record === "string" ? record : serializeStoredValue(record);
    return base;
  }
  for (const [field, value] of Object.entries(record)) {
    const label = arabicFieldLabels[field] ?? field;
    if (value && typeof value === "object") {
      base[label] = serializeStoredValue(localizeReadableValue(value));
    } else {
      base[label] = value ?? "";
    }
  }
  return base;
}

function readableSheetRows(storage: Record<string, unknown>) {
  const groups: Record<string, Array<Record<string, unknown>>> = {
    "العملاء": [],
    "الزيارات": [],
    "التذكيرات": [],
    "الخزينة": [],
    "المخزن": [],
    "التقارير": [],
    "العمليات المعلقة": [],
    "بيانات الحساب": [],
    "بيانات محلية": [],
  };

  for (const [key, value] of Object.entries(storage)) {
    // هذه الورقة هي المصدر الكامل للاستعادة، لذلك تضم كل مفتاح purepoint بلا استثناء.
    groups["بيانات محلية"].push({ "مفتاح البيانات": key, "القيمة": serializeStoredValue(value) });

    let groupName = "بيانات محلية";
    if (key.includes("customers")) groupName = "العملاء";
    else if (key.includes("visits")) groupName = "الزيارات";
    else if (key.includes("report")) groupName = "التقارير";
    else if (key.includes("cash")) groupName = "الخزينة";
    else if (key.includes("inventory")) groupName = "المخزن";
    else if (key.includes("pending")) groupName = "العمليات المعلقة";
    else if (key.includes("session")) groupName = "بيانات الحساب";

    if (Array.isArray(value)) {
      value.forEach((record, index) => groups[groupName].push(readableRecordRow(key, record, index)));
    } else {
      groups[groupName].push(readableRecordRow(key, value, 0));
    }
  }
  return groups;
}

function setArabicSheetLayout(sheet: XLSX.WorkSheet) {
  sheet["!rtl"] = true;
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  const widths: XLSX.ColInfo[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    let maxLength = 12;
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 80); row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ c: column, r: row })];
      maxLength = Math.max(maxLength, String(cell?.v ?? "").length);
    }
    widths.push({ wch: Math.min(42, Math.max(12, maxLength + 2)) });
  }
  sheet["!cols"] = widths;
}

export function downloadOfflineBackup(now = new Date()) {
  if (!available()) return false;
  const backup = createOfflineBackup(now);
  const workbook = XLSX.utils.book_new();
  const groups = readableSheetRows(backup.storage);
  const summary = [{
    "اسم التطبيق": backup.app,
    "نوع النسخة": "نسخة احتياطية محلية Excel",
    "تاريخ الإنشاء": now.toLocaleString("ar-EG"),
    "عدد مفاتيح البيانات": Object.keys(backup.storage).length,
    "طريقة الاستعادة": "من زر استعادة ثم اختيار ملف Excel هذا",
  }];
  const summarySheet = XLSX.utils.json_to_sheet(summary);
  setArabicSheetLayout(summarySheet);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "ملخص النسخة");
  for (const [sheetName, rows] of Object.entries(groups)) {
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "مفتاح البيانات": "لا توجد بيانات", "القيمة": "" }]);
    setArabicSheetLayout(sheet);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `pure-point-backup-${stamp}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function getOfflineBackupKeyCount() {
  return Object.keys(createOfflineBackup().storage).length;
}

export type OfflineRestoreResult = { restoredKeys: number; exportedAt: string };

function isOfflineBackup(value: unknown): value is OfflineBackup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OfflineBackup>;
  return candidate.format === "purepoint-offline-backup" && candidate.version === 1 && typeof candidate.exportedAt === "string" && !!candidate.storage && typeof candidate.storage === "object" && !Array.isArray(candidate.storage);
}

function preserveCurrentTrashWhenBackupDoesNotIncludeIt(entries: Array<[string, unknown]>) {
  if (entries.some(([key]) => key === "purepoint-trash-bin") || !available()) return entries;
  const raw = localStorage.getItem("purepoint-trash-bin");
  if (raw === null) return entries;
  try {
    return [...entries, ["purepoint-trash-bin", JSON.parse(raw)] as [string, unknown]];
  } catch {
    return entries;
  }
}

export function restoreOfflineBackup(value: unknown): OfflineRestoreResult {
  if (!available()) throw new Error("التخزين المحلي غير متاح على هذا الجهاز.");
  if (!isOfflineBackup(value)) throw new Error("ملف النسخة الاحتياطية غير صالح أو غير مدعوم.");
  const entries = preserveCurrentTrashWhenBackupDoesNotIncludeIt(Object.entries(value.storage).filter(([key, storedValue]) => key.startsWith("purepoint-") && storedValue !== undefined));
  if (entries.length === 0) throw new Error("النسخة الاحتياطية لا تحتوي على بيانات نقطة نقاء.");
  const currentKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("purepoint-")) currentKeys.push(key);
  }
  for (const key of currentKeys) localStorage.removeItem(key);
  for (const [key, storedValue] of entries) localStorage.setItem(key, JSON.stringify(storedValue));
  return { restoredKeys: entries.length, exportedAt: value.exportedAt };
}

export function restoreOfflineBackupFromText(text: string): OfflineRestoreResult {
  try {
    return restoreOfflineBackup(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("تعذر قراءة ملف النسخة الاحتياطية؛ تأكد من أنه ملف JSON صحيح.");
    throw error;
  }
}

export function restoreOfflineBackupFromExcel(data: ArrayBuffer): OfflineRestoreResult {
  if (!available()) throw new Error("التخزين المحلي غير متاح على هذا الجهاز.");
  try {
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets["بيانات محلية"];
    if (!sheet) throw new Error("ملف Excel لا يحتوي على ورقة البيانات المحلية المطلوبة.");
    const rows = XLSX.utils.sheet_to_json<{ "مفتاح البيانات"?: string; "القيمة"?: string }>(sheet);
    const parsedEntries: Array<[string, unknown]> = [];
    for (const row of rows) {
      const key = row["مفتاح البيانات"];
      const raw = row["القيمة"];
      if (!key || key === "لا توجد بيانات" || !key.startsWith("purepoint-") || raw === undefined) continue;
      try { parsedEntries.push([key, JSON.parse(String(raw))]); } catch { parsedEntries.push([key, raw]); }
    }
    const entries = preserveCurrentTrashWhenBackupDoesNotIncludeIt(parsedEntries);
    if (entries.length === 0) throw new Error("النسخة الاحتياطية لا تحتوي على بيانات نقطة نقاء قابلة للاستعادة.");
    const currentKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("purepoint-")) currentKeys.push(key);
    }
    for (const key of currentKeys) localStorage.removeItem(key);
    for (const [key, value] of entries) localStorage.setItem(key, JSON.stringify(value));
    return { restoredKeys: entries.length, exportedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof Error && error.message.includes("لا يحتوي")) throw error;
    throw new Error("تعذر قراءة ملف Excel؛ تأكد من أنه ملف نسخة احتياطية صادر من تطبيق نقطة نقاء.");
  }
}
