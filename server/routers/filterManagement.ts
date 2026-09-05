import { TRPCError } from "@trpc/server";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { parse as parseCookie } from "cookie";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeEvidenceDataUrl, isSupportedEvidenceMime } from "../utils/evidence";
import {
  cashTransactions,
  customers,
  inventoryItems,
  inventoryMovements,
  notificationSettings,
  serviceTypeItems,
  serviceTypes,
  visitItems,
  reminders,
  visits,
  users,
  allowedTechnicianAccounts,
  technicianLocations,
  workOrderProofs,
} from "../../drizzle/schema";
  isReminderAlertActive,
  needsAutomaticReminder,
  visitTypes,
} from "../../shared/filterBusiness";
import { getDb, upsertUser } from "../db";
import { calculateInventoryPurchaseAmount, shouldCreateInventoryPurchase } from "../inventoryPurchase";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { COOKIE_NAME } from "../../shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { createLocalSessionToken } from "../_core/localAuth";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { BACKUP_TABLES, createOwnerBackup, getOwnerBackupStatus, refreshOwnerBackup } from "../backup";
import { storageGet, storagePut } from "../storage";

type TechnicianMenuPermission = "workOrders" | "pendingOperations" | "customers" | "visits";
const defaultTechnicianMenuPermissions: TechnicianMenuPermission[] = ["workOrders"];
export function parseTechnicianMenuPermissions(value: string | null | undefined): TechnicianMenuPermission[] {
  try {
    const parsed = JSON.parse(value || "[]");
    const allowed = parsed.filter((item: unknown): item is TechnicianMenuPermission => item === "workOrders" || item === "pendingOperations" || item === "customers" || item === "visits");
    return allowed.length ? Array.from(new Set(allowed)) : defaultTechnicianMenuPermissions;
  } catch {
    return defaultTechnicianMenuPermissions;
  }
}

const customerInput = z.object({
  name: z.string().trim().min(2, "أدخل اسم العميل").max(160),
  manualCode: z.string().trim().max(64).optional().nullable(),
  phone: z.string().trim().min(6, "أدخل رقم هاتف صحيح").max(32),
  address: z.string().trim().max(1000).optional().nullable(),
  latitude: z.string().trim().max(32).optional().nullable(),
  longitude: z.string().trim().max(32).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
  serviceDate: z.date().optional().nullable(),
  collectedAmount: z.number().int().nonnegative().optional().nullable(),
});

function normalizeCustomerName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

const customerCreateInput = customerInput.extend({
  firstVisitType: z.enum(visitTypes).optional(),
  firstVisitDate: z.date().optional(),
  followUpDays: z.number().int().min(0).max(3650).optional(),
  firstTechnicianName: z.string().trim().max(160).optional().nullable(),
  firstTechnicianId: z.number().int().positive().optional().nullable(),
  firstSalesAgentName: z.string().trim().max(160).optional().nullable(),
  firstFilterCount: z.number().int().positive().max(1000).optional().default(1),
  firstTdsIn: z.number().int().nonnegative().max(100000).optional().nullable(),
  firstTdsOut: z.number().int().nonnegative().max(100000).optional().nullable(),
  firstVisitNotes: z.string().trim().max(2000).optional().nullable(),
  firstVisitResult: z.string().trim().max(2000).optional().nullable(),
  firstCollectedAmount: z.number().int().nonnegative().optional().default(0),
  firstCollectedCurrency: z.enum(cashCurrencies).optional().default("SAR"),
  items: z.array(z.object({
    inventoryItemId: z.number().int().positive(),
    quantity: z.number().int().positive("أدخل كمية أكبر من صفر"),
    source: z.enum(["default", "manual"]).default("default"),
  })).max(50).optional().default([]),
});

const customerImportRowInput = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string().trim().min(2, "اسم العميل مطلوب").max(160),
  phone: z.string().trim().min(6, "رقم الهاتف غير صالح").max(32),
  manualCode: z.string().trim().max(64).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  location: z.string().trim().max(100).optional().nullable(),
  latitude: z.string().trim().max(32).optional().nullable(),
  longitude: z.string().trim().max(32).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  technicianName: z.string().trim().max(160).optional().nullable(),
  salesAgentName: z.string().trim().max(160).optional().nullable(),
  filterCount: z.number().int().positive().max(1000).optional().default(1),
  visitDate: z.coerce.date().optional().nullable(),
  visitType: z.enum(visitTypes).optional().nullable(),
  collectedAmount: z.number().nonnegative().max(999999999).optional().nullable(),
});

const workOrderProofInput = z.object({
  visitId: z.number().int().positive(),
  kind: z.enum(["photo", "signature", "audio"]),
  photoSlot: z.enum(["before", "after", "general"]).optional(),
  dataUrl: z.string().max(12_000_000).transform(value => normalizeEvidenceDataUrl(value)).refine(value => value !== null, "صيغة الدليل غير صالحة").transform(value => value as string),
});

const visitItemInput = z.object({
  inventoryItemId: z.number().int().positive(),
  quantity: z.number().int().positive("أدخل كمية أكبر من صفر"),
  source: z.enum(["default", "manual"]).default("default"),
});

const visitInput = z.object({
  customerId: z.number().int().positive(),
  phone: z.string().trim().max(32).optional().nullable(),
  visitType: z.enum(visitTypes),
  visitDate: z.date(),
  nextVisitDate: z.date().optional().nullable(),
  followUpDays: z.number().int().min(0).max(3650).optional(),
  technicianName: z.string().trim().max(160).optional().nullable(),
  assignedTechnicianId: z.number().int().positive().optional().nullable(),
  salesAgentName: z.string().trim().max(160).optional().nullable(),
  filterCount: z.number().int().positive().max(1000).optional().default(1),
  tdsIn: z.number().int().nonnegative().max(100000).optional().nullable(),
  tdsOut: z.number().int().nonnegative().max(100000).optional().nullable(),
  visitResult: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  collectedAmount: z.number().int().nonnegative().max(100000, "مبلغ التحصيل يجب ألا يتجاوز 100,000 ريال.").optional().default(0),
  collectedCurrency: z.enum(cashCurrencies).optional().default("SAR"),
  clientOperationId: z.string().uuid().optional(),
  items: z.array(visitItemInput).max(50).optional().default([]),
});

const workOrderStatusValues = ["assigned", "en_route", "arrived", "in_progress", "completed", "postponed", "cancelled"] as const;
const executionOutcomeValues = ["completed", "not_completed"] as const;
const workOrderCreateInput = z.object({
  customerId: z.number().int().positive(),
  visitType: z.enum(visitTypes),
  visitDate: z.date(),
  assignedTechnicianId: z.number().int().positive(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
});
const workOrderUpdateInput = z.object({
  id: z.number().int().positive(),
  status: z.enum(workOrderStatusValues),
  nextVisitDate: z.date().optional().nullable(),
  followUpDays: z.number().int().nonnegative().max(3650).optional().nullable(),
  visitResult: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  executionOutcome: z.enum(executionOutcomeValues).optional().nullable(),
  notCompletedReason: z.string().trim().max(1000).optional().nullable(),
  collectedAmount: z.number().int().nonnegative().max(100000, "مبلغ التحصيل يجب ألا يتجاوز 100,000 ريال.").optional().default(0),
  tdsIn: z.number().int().nonnegative().max(100000).optional().nullable(),
  tdsOut: z.number().int().nonnegative().max(100000).optional().nullable(),
  collectedCurrency: z.enum(cashCurrencies).optional().default("SAR"),
  items: z.array(visitItemInput).max(50).optional().default([]),
}).superRefine((input, ctx) => {
  if (input.executionOutcome === "not_completed" && !input.notCompletedReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notCompletedReason"], message: "سبب عدم التنفيذ مطلوب." });
  }
});

const inventoryItemInput = z.object({
  name: z.string().trim().min(2, "أدخل اسم الصنف").max(160),
  category: z.string().trim().min(2).max(120).default("عام"),
  unit: z.string().trim().min(1).max(40).default("قطعة"),
  reorderLevel: z.number().int().min(0).max(999999).default(2),
  defaultUnitCost: z.number().int().nonnegative().max(999999999).default(0),
  openingQuantity: z.number().int().min(0).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  customEmoji: z.string().trim().max(8).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
});

const inventoryAppearanceInput = z.object({
  inventoryItemId: z.number().int().positive(),
  customEmoji: z.string().trim().max(8).optional().nullable(),
  imageDataUrl: z.string().max(1_500_000).optional().nullable(),
  clearImage: z.boolean().optional().default(false),
});

const inventoryMovementInput = z.object({
  inventoryItemId: z.number().int().positive(),
  movementType: z.enum(["incoming", "outgoing"]),
  quantity: z.number().int().positive("أدخل كمية أكبر من صفر"),
  unitCost: z.number().int().nonnegative().optional().default(0),
  currency: z.enum(cashCurrencies).optional().default("SAR"),
  movementDate: z.date(),
  technicianName: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
});

const cashTransactionInput = z.object({
  transactionType: z.enum(cashTransactionTypes),
  currency: z.enum(cashCurrencies).optional().default("SAR"),
  amount: z.number().int().positive("أدخل مبلغًا أكبر من صفر"),
  category: z.string().trim().min(2, "أدخل تصنيف العملية").max(100),
  transactionDate: z.date(),
  recipientName: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
});

const notificationSettingsInput = z.object({
  leadDays: z.number().int().min(1).max(14).default(DEFAULT_ALERT_LEAD_DAYS),
  alertHour: z.number().int().min(0).max(23).default(DEFAULT_ALERT_HOUR),
  alertMinute: z.number().int().min(0).max(59).default(DEFAULT_ALERT_MINUTE),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).default(DEFAULT_TIMEZONE_OFFSET_MINUTES),
  companyName: z.string().trim().max(160).optional().nullable(),
  companyWhatsAppPhone: z.string().trim().max(32).optional().nullable(),
});
const pinValue = z.string().trim().min(4, "الرقم السري يجب أن يتكون من 4 أحرف أو أرقام على الأقل.").max(64);
const notificationSettingsSaveInput = notificationSettingsInput.extend({ pin: pinValue.optional() });
const pinSetupInput = z.object({ newPin: pinValue, currentPin: pinValue.optional() });

const defaultNotificationSettings = {
  leadDays: DEFAULT_ALERT_LEAD_DAYS,
  alertHour: DEFAULT_ALERT_HOUR,
  alertMinute: DEFAULT_ALERT_MINUTE,
  timezoneOffsetMinutes: DEFAULT_TIMEZONE_OFFSET_MINUTES,
  companyName: null,
  companyWhatsAppPhone: null,
  pinHash: null,
};

const sensitivePinInput = z.object({ pin: z.string().trim().min(4, "الرقم السري يجب أن يتكون من 4 أحرف أو أرقام على الأقل.").max(64) });
const scryptAsync = promisify(scrypt);

export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(pin, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPin(pin: string, encodedHash: string) {
  const [salt, storedHex] = encodedHash.split(":");
  if (!salt || !storedHex) return false;
  const stored = Buffer.from(storedHex, "hex");
  const derived = (await scryptAsync(pin, salt, stored.length)) as Buffer;
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

async function databaseOrThrow() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات." });
  }
  return db;
}

type CustomerCreationKey = Pick<typeof customers.$inferSelect, "id" | "createdAt">;

function compareCustomersByCreation(left: CustomerCreationKey, right: CustomerCreationKey) {
  const leftTime = left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
  const rightTime = right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
  return leftTime - rightTime || left.id - right.id;
}

function customerNumberMap(customerRows: CustomerCreationKey[]) {
  return new Map(customerRows.map((customer, index) => [customer.id, index + 1]));
}

async function getOwnedCustomer(ownerId: number, customerId: number) {
  const db = await databaseOrThrow();
  const customer = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.ownerId, ownerId)))
    .limit(1);
  if (!customer[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على العميل." });
  }
  return customer[0];
}

async function getCompanyOwnerId(userId: number, role?: string) {
  if (role === "admin") return userId;
  const db = await databaseOrThrow();
  const currentUser = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (currentUser[0]?.role === "admin") return userId;
  const account = await db
    .select({ ownerId: allowedTechnicianAccounts.ownerId })
    .from(allowedTechnicianAccounts)
    .where(and(eq(allowedTechnicianAccounts.linkedUserId, userId), eq(allowedTechnicianAccounts.isActive, true)))
    .limit(1);
  if (!account[0]) throw new TRPCError({ code: "FORBIDDEN", message: "حساب الفني غير مرتبط بشركة فعالة." });
  return account[0].ownerId;
}

type OwnedTechnician = { id: number; name: string | null; displayName: string };

async function findOwnedTechnician(ownerId: number, technicianId?: number | null, technicianName?: string | null): Promise<OwnedTechnician | null> {
  if (!technicianId && !technicianName?.trim()) return null;
  const db = await databaseOrThrow();
  const name = technicianName?.trim();
  const match = await db
    .select({ id: users.id, name: users.name, displayName: allowedTechnicianAccounts.displayName })
    .from(users)
    .innerJoin(allowedTechnicianAccounts, eq(allowedTechnicianAccounts.linkedUserId, users.id))
    .where(and(
      eq(allowedTechnicianAccounts.ownerId, ownerId),
      eq(allowedTechnicianAccounts.isActive, true),
      eq(users.role, "user"),
      technicianId ? eq(users.id, technicianId) : or(eq(users.name, name!), eq(allowedTechnicianAccounts.displayName, name!)),
    ))
    .limit(1);
  return match[0] ?? null;
}

async function resolveAssignedTechnician(ownerId: number, currentUserId: number | null, technicianId?: number | null, technicianName?: string | null) {
  const requested = await findOwnedTechnician(ownerId, technicianId, technicianName);
  if (requested) return { id: requested.id, name: requested.name || requested.displayName };
  if (technicianId || technicianName?.trim()) throw new TRPCError({ code: "NOT_FOUND", message: "الفني غير موجود أو غير مرتبط بحساب الشركة." });
  if (!currentUserId) return null;
  const current = await findOwnedTechnician(ownerId, currentUserId);
  return current ? { id: current.id, name: current.name || current.displayName } : null;
}

function withCustomerFollowUp(
  customer: typeof customers.$inferSelect,
  customerVisits: Array<typeof visits.$inferSelect>,
  customerNumber = customer.id,
  now = new Date(),
) {
  return {
    ...customer,
    customerCode: customer.manualCode?.trim() || customerCode(customerNumber),
    followUp: followUpSummaryFromVisits(customerVisits, now),
  };
}

async function inventorySummary(ownerId: number) {
  const db = await databaseOrThrow();
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.ownerId, ownerId)).orderBy(desc(inventoryItems.createdAt));
  if (items.length === 0) return { items: [], movements: [] };
  const itemIds = items.map(item => item.id);
  const movements = await db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.ownerId, ownerId), inArray(inventoryMovements.inventoryItemId, itemIds)))
    .orderBy(desc(inventoryMovements.movementDate));
  const customerIds = Array.from(new Set(movements.map(movement => movement.customerId).filter((id): id is number => Boolean(id))));
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.ownerId, ownerId), inArray(customers.id, customerIds)))
    : [];
  const customerNames = new Map(customerRows.map(customer => [customer.id, customer.name]));
  const itemBalances = items.map(item => {
    const itemMovements = movements.filter(movement => movement.inventoryItemId === item.id);
    const openingMovement = itemMovements
      .filter(movement => movement.movementType === "incoming" && movement.notes?.startsWith("الرصيد الافتتاحي"))
      .sort((a, b) => new Date(a.movementDate).getTime() - new Date(b.movementDate).getTime())[0];
    return {
      ...item,
      openingQuantity: item.openingQuantity || openingMovement?.quantity || 0,
      openingUnitCost: openingMovement?.unitCost ?? item.defaultUnitCost ?? 0,
      openingAddedAt: openingMovement?.movementDate ?? item.createdAt,
      currentBalance: calculateStockBalance(item.openingQuantity, itemMovements),
    };
  });
  return {
    items: itemBalances,
    movements: movements.map(movement => ({
      ...movement,
      inventoryItemName: items.find(item => item.id === movement.inventoryItemId)?.name ?? "صنف غير معروف",
      customerName: movement.customerId ? customerNames.get(movement.customerId) ?? "عميل غير معروف" : null,
    })),
  };
}

type CashIncomeFilter = "all" | "service" | "installation" | "maintenance";
export type CashPartyType = "all" | "technician" | "customer" | "entity";
type CashDateFilter = { month?: string; startDate?: string; endDate?: string };
type CashCategoryFilter = { category?: string; technician?: string; itemName?: string; partyType?: CashPartyType };

export function classifyCashParty(transaction: { sourceVisitId?: number | null; category: string; recipientName?: string | null; notes?: string | null }): Exclude<CashPartyType, "all"> {
  if (transaction.sourceVisitId || transaction.category.startsWith("تحصيل")) return "customer";
  const searchable = `${transaction.category} ${transaction.recipientName ?? ""} ${transaction.notes ?? ""}`;
  if (/فني|راتب|عمولة/.test(searchable)) return "technician";
  return "entity";
}

function matchesCashDateFilter(date: Date, dateFilter?: CashDateFilter) {
  if (!dateFilter?.month && !dateFilter?.startDate && !dateFilter?.endDate) return true;
  const dateKey = date.toISOString().slice(0, 10);
  if (dateFilter.month && dateKey.slice(0, 7) !== dateFilter.month) return false;
  if (dateFilter.startDate && dateKey < dateFilter.startDate) return false;
  if (dateFilter.endDate && dateKey > dateFilter.endDate) return false;
  return true;
}

async function cashSummary(ownerId: number, incomeFilter: CashIncomeFilter = "all", dateFilter?: CashDateFilter, search?: string, categoryFilter: CashCategoryFilter = {}) {
  const db = await databaseOrThrow();
  const filters = [eq(cashTransactions.ownerId, ownerId)];
  if (incomeFilter === "service") {
    filters.push(eq(cashTransactions.transactionType, "income"));
  }
  const transactions = await db
    .select()
    .from(cashTransactions)
    .where(and(...filters))
    .orderBy(desc(cashTransactions.transactionDate));
  const sourceVisitIds = Array.from(new Set(transactions.map(transaction => transaction.sourceVisitId).filter((id): id is number => Boolean(id))));
  const sourceVisits = sourceVisitIds.length
    ? await db.select({ id: visits.id, technicianName: visits.technicianName }).from(visits).where(and(eq(visits.ownerId, ownerId), inArray(visits.id, sourceVisitIds)))
    : [];
  const technicianByVisitId = new Map(sourceVisits.map(visit => [visit.id, visit.technicianName]));
  const displayTransactions = transactions.map(transaction => {
    const technicianName = transaction.sourceVisitId ? technicianByVisitId.get(transaction.sourceVisitId) : undefined;
    return technicianName !== undefined ? { ...transaction, recipientName: technicianName } : transaction;
  });
  const filteredTransactions = displayTransactions.filter(transaction => {
    const isInstallationIncome = transaction.category === "تحصيل تركيب";
    const isMaintenanceIncome = transaction.category === "تحصيل صيانة";
    const isServiceIncome = isInstallationIncome || isMaintenanceIncome;
    const matchesIncome = incomeFilter === "all"
      || (incomeFilter === "service" && transaction.transactionType === "income" && isServiceIncome)
      || (incomeFilter === "installation" && transaction.transactionType === "income" && isInstallationIncome)
      || (incomeFilter === "maintenance" && transaction.transactionType === "income" && isMaintenanceIncome);
    const matchesCategory = !categoryFilter.category || transaction.category === categoryFilter.category;
    const matchesTechnician = !categoryFilter.technician || transaction.recipientName === categoryFilter.technician;
    const matchesPartyType = !categoryFilter.partyType || categoryFilter.partyType === "all" || classifyCashParty(transaction) === categoryFilter.partyType;
    return matchesIncome && matchesCategory && matchesTechnician && matchesPartyType
      && matchesCashDateFilter(new Date(transaction.transactionDate), dateFilter)
      && matchesCashTransactionSearch(transaction, search);
  });
  const [purchaseItems, purchaseMovements] = await Promise.all([
    db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.ownerId, ownerId)),
    db.select().from(inventoryMovements).where(eq(inventoryMovements.ownerId, ownerId)),
  ]);
  const itemNames = new Map(purchaseItems.map(item => [item.id, item.name]));
  const filteredPurchaseMovements = purchaseMovements
    .map(movement => ({ ...movement, itemName: itemNames.get(movement.inventoryItemId) ?? "صنف غير معروف" }))
    .filter(movement => !categoryFilter.itemName || movement.itemName === categoryFilter.itemName)
    .filter(movement => matchesCashDateFilter(new Date(movement.movementDate), dateFilter))
    .filter(movement => matchesCashTransactionSearch({ category: movement.itemName, notes: movement.notes, recipientName: movement.technicianName }, search));
  const summaries = calculateCashSummaries(filteredTransactions);
  // الرصيد التاريخي لا يعتمد على البحث أو تصفية التصنيف؛ بل على كل حركات الخزنة حتى نهاية اليوم،
  // حتى يبقى «الرصيد الفعلي» صحيحًا حتى عند عرض جزء من الحركات فقط.
  const historicalSummary = { SAR: calculateCashSummaryThroughDate(displayTransactions, dateFilter?.endDate) };
  const breakdown = calculateCashBreakdown(filteredTransactions);
  const financialOverview = calculateCompanyFinancialOverview(filteredTransactions);
  const purchases = calculatePurchaseBreakdown(filteredPurchaseMovements);
  const availableCategories = Array.from(new Set(transactions.map(transaction => transaction.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
  const availableTechnicians = Array.from(new Set(displayTransactions.map(transaction => transaction.recipientName).filter((name): name is string => Boolean(name?.trim())))).sort((a, b) => a.localeCompare(b, "ar"));
  const availableItemNames = Array.from(new Set(itemNames.values())).sort((a, b) => a.localeCompare(b, "ar"));
  return { transactions: filteredTransactions, ...summaries.SAR, summaries, historicalBalance: historicalSummary.SAR.balance, historicalIncomeTotal: historicalSummary.SAR.incomeTotal, historicalExpenseTotal: historicalSummary.SAR.expenseTotal, breakdown, financialOverview, purchases, incomeFilter, categoryFilter, availableCategories, availableTechnicians, availablePartyTypes: ["technician", "customer", "entity"] as const, availableItemNames, search: search?.trim() ?? "" };
}

async function remindersWithCustomers(ownerId: number, onlyDue: boolean, withinDays?: number) {
  const db = await databaseOrThrow();
  const filters = [eq(reminders.ownerId, ownerId), eq(reminders.status, "pending")];
  if (onlyDue) filters.push(lte(reminders.reminderDate, new Date()));
  if (withinDays !== undefined) filters.push(lte(reminders.reminderDate, new Date(Date.now() + withinDays * 86400000)));
  const rows = await db.select().from(reminders).where(and(...filters)).orderBy(reminders.reminderDate);
  if (rows.length === 0) return [];
  const customerIds = Array.from(new Set(rows.map(row => row.customerId)));
  const visitIds = Array.from(new Set(rows.map(row => row.visitId)));
  const [customerRows, sourceVisits, allCustomers] = await Promise.all([
    db.select().from(customers).where(and(eq(customers.ownerId, ownerId), inArray(customers.id, customerIds))),
    db.select().from(visits).where(and(eq(visits.ownerId, ownerId), inArray(visits.id, visitIds))),
    db.select({ id: customers.id, createdAt: customers.createdAt }).from(customers).where(eq(customers.ownerId, ownerId)),
  ]);
  const customerById = new Map(customerRows.map(customer => [customer.id, customer]));
  const customerNumbers = customerNumberMap([...allCustomers].sort(compareCustomersByCreation));
  const visitById = new Map(sourceVisits.map(visit => [visit.id, visit]));
  const now = new Date();
  return rows.map(reminder => {
    const customer = customerById.get(reminder.customerId);
    const sourceVisit = visitById.get(reminder.visitId);
    const daysRemaining = daysUntilFollowUp(reminder.reminderDate, now);
    return {
      ...reminder,
      lastServiceVisitType: sourceVisit?.visitType ?? null,
      lastServiceVisitDate: sourceVisit?.visitDate ?? null,
      daysOverdue: Math.max(0, -daysRemaining),
      customer: customer
        ? {
            ...customer,
            customerCode: customer.manualCode?.trim() || customerCode(customerNumbers.get(customer.id) ?? customer.id),
            followUp: { nextVisitDate: reminder.reminderDate, daysRemaining },
          }
        : null,
    };
  });
}

async function getNotificationSettingsRow(ownerId: number) {
  const db = await databaseOrThrow();
  const rows = await db.select().from(notificationSettings).where(eq(notificationSettings.ownerId, ownerId)).limit(1);
  return rows[0] ?? { ownerId, ...defaultNotificationSettings, scheduleCronTaskUid: null, id: 0, backupFileKey: null, backupGeneratedAt: null, createdAt: new Date(), updatedAt: new Date() };
}

async function getNotificationSettings(ownerId: number) {
  const { pinHash: _pinHash, ...safeSettings } = await getNotificationSettingsRow(ownerId);
  return safeSettings;
}

async function requirePin(ownerId: number, pin: string) {
  const settings = await getNotificationSettingsRow(ownerId);
  if (!settings.pinHash) {
    throw new TRPCError({ code: "FORBIDDEN", message: "لم يتم ضبط رقم سري بعد. افتح الإعدادات وأنشئ رقمًا سريًا أولًا." });
  }
  if (!(await verifyPin(pin, settings.pinHash))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الرقم السري غير صحيح." });
  }
}

async function requirePinIfConfigured(ownerId: number, pin?: string) {
  const settings = await getNotificationSettingsRow(ownerId);
  if (settings.pinHash) {
    if (!pin) throw new TRPCError({ code: "FORBIDDEN", message: "أدخل الرقم السري لتعديل الإعدادات." });
    await requirePin(ownerId, pin);
  }
}

export const filterManagementRouter = router({
  technicianAuth: router({
    login: publicProcedure.input(z.object({ email: z.string().trim().email("أدخل بريدًا إلكترونيًا صحيحًا").max(320), password: z.string().min(8, "كلمة السر يجب أن تتكون من 8 أحرف أو أرقام على الأقل.").max(128) })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const email = input.email.trim().toLowerCase();
      const account = (await db.select().from(allowedTechnicianAccounts).where(and(eq(allowedTechnicianAccounts.email, email), eq(allowedTechnicianAccounts.isActive, true))).limit(1))[0];
      if (!account?.passwordHash || !(await verifyPin(input.password, account.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "البريد أو كلمة السر غير صحيحة، أو أن الحساب غير مفعل." });
      }
      let user = account.linkedUserId ? (await db.select().from(users).where(and(eq(users.id, account.linkedUserId), eq(users.role, "user"))).limit(1))[0] : undefined;
      if (!user) {
        const openId = `local-technician-${account.ownerId}-${account.id}`;
        await upsertUser({ openId, name: account.displayName, email: account.email, loginMethod: "technician-password", role: "user", lastSignedIn: new Date() });
        user = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
        if (user) await db.update(allowedTechnicianAccounts).set({ linkedUserId: user.id }).where(eq(allowedTechnicianAccounts.id, account.id));
      } else {
        await upsertUser({ openId: user.openId, name: account.displayName, email: account.email, loginMethod: "technician-password", role: "user", lastSignedIn: new Date() });
        user = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
      }
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تجهيز حساب الفني." });
      const token = await createLocalSessionToken(user);
      ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: 30 * 24 * 60 * 60 * 1000 });
      return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    }),
  }),
  allowedTechnicians: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const rows = await db.select({ id: allowedTechnicianAccounts.id, ownerId: allowedTechnicianAccounts.ownerId, email: allowedTechnicianAccounts.email, displayName: allowedTechnicianAccounts.displayName, linkedUserId: allowedTechnicianAccounts.linkedUserId, isActive: allowedTechnicianAccounts.isActive, menuPermissions: allowedTechnicianAccounts.menuPermissions, createdAt: allowedTechnicianAccounts.createdAt, updatedAt: allowedTechnicianAccounts.updatedAt, hasPassword: allowedTechnicianAccounts.passwordHash }).from(allowedTechnicianAccounts).where(eq(allowedTechnicianAccounts.ownerId, ctx.user.id)).orderBy(desc(allowedTechnicianAccounts.createdAt));
      return rows.map(row => ({ ...row, menuPermissions: parseTechnicianMenuPermissions(row.menuPermissions) }));
    }),
    myPermissions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin") return { menuPermissions: ["workOrders"] as TechnicianMenuPermission[] };
      const db = await databaseOrThrow();
      const account = (await db.select({ menuPermissions: allowedTechnicianAccounts.menuPermissions }).from(allowedTechnicianAccounts).where(and(eq(allowedTechnicianAccounts.linkedUserId, ctx.user.id), eq(allowedTechnicianAccounts.isActive, true))).limit(1))[0];
      return { menuPermissions: parseTechnicianMenuPermissions(account?.menuPermissions) };
    }),
    updateMenuPermissions: adminProcedure.input(z.object({ id: z.number().int().positive(), menuPermissions: z.array(z.enum(["workOrders", "pendingOperations", "customers", "visits"])).min(1).max(4) })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const updated = await db.update(allowedTechnicianAccounts).set({ menuPermissions: JSON.stringify(Array.from(new Set(input.menuPermissions))) }).where(and(eq(allowedTechnicianAccounts.id, input.id), eq(allowedTechnicianAccounts.ownerId, ctx.user.id)));
      if (!updated[0]?.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود." });
      return { success: true };
    }),
    create: adminProcedure.input(z.object({
      email: z.string().trim().email("أدخل بريدًا إلكترونيًا صحيحًا").max(320),
      displayName: z.string().trim().min(2, "أدخل اسم الفني").max(160),
      password: z.string().min(8, "كلمة السر يجب أن تتكون من 8 أحرف أو أرقام على الأقل.").max(128),
    })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const email = input.email.trim().toLowerCase();
      const existing = await db.select({ id: allowedTechnicianAccounts.id }).from(allowedTechnicianAccounts).where(and(eq(allowedTechnicianAccounts.ownerId, ctx.user.id), eq(allowedTechnicianAccounts.email, email))).limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "هذا البريد مسجل بالفعل ضمن الحسابات المسموح بها." });
      const matchedUser = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
      if (matchedUser[0]?.role === "admin") throw new TRPCError({ code: "CONFLICT", message: "لا يمكن اعتماد حساب إداري كحساب فني." });
      const passwordHash = await hashPin(input.password);
      const inserted = await db.insert(allowedTechnicianAccounts).values({ ownerId: ctx.user.id, email, displayName: input.displayName.trim(), linkedUserId: matchedUser[0]?.id ?? null, passwordHash, isActive: true });
      const accountId = Number(inserted[0].insertId);
      if (!matchedUser[0]) {
        const openId = `local-technician-${ctx.user.id}-${accountId}`;
        await upsertUser({ openId, name: input.displayName.trim(), email, loginMethod: "technician-password", role: "user", lastSignedIn: new Date() });
        const localUser = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
        if (localUser[0]) await db.update(allowedTechnicianAccounts).set({ linkedUserId: localUser[0].id }).where(eq(allowedTechnicianAccounts.id, accountId));
      }
      return { id: accountId, linked: true };
    }),
    setPassword: adminProcedure.input(z.object({ id: z.number().int().positive(), password: z.string().min(8, "كلمة السر يجب أن تتكون من 8 أحرف أو أرقام على الأقل.").max(128) })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const passwordHash = await hashPin(input.password);
      const updated = await db.update(allowedTechnicianAccounts).set({ passwordHash }).where(and(eq(allowedTechnicianAccounts.id, input.id), eq(allowedTechnicianAccounts.ownerId, ctx.user.id)));
      if (!updated[0]?.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود." });
      return { success: true };
    }),
    setActive: adminProcedure.input(z.object({ id: z.number().int().positive(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const updated = await db.update(allowedTechnicianAccounts).set({ isActive: input.isActive }).where(and(eq(allowedTechnicianAccounts.id, input.id), eq(allowedTechnicianAccounts.ownerId, ctx.user.id)));
      if (!updated[0]?.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود." });
      return { success: true };
    }),
  }),
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await databaseOrThrow();
    const ownerId = ctx.user.id;
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const endOfUpcomingWindow = new Date(startOfToday);
    endOfUpcomingWindow.setDate(endOfUpcomingWindow.getDate() + 6);
    endOfUpcomingWindow.setMilliseconds(-1);
    const [todayVisits, upcomingVisits, upcomingFollowUps, dueReminders, inventory, cash, chartTransactions, workOrderRows] = await Promise.all([
      db.select().from(visits).where(and(eq(visits.ownerId, ownerId), gte(visits.visitDate, startOfToday), lte(visits.visitDate, endOfToday))).orderBy(visits.visitDate),
      db.select().from(visits).where(and(eq(visits.ownerId, ownerId), gte(visits.visitDate, endOfToday), lte(visits.visitDate, endOfUpcomingWindow))).orderBy(visits.visitDate).limit(20),
      remindersWithCustomers(ownerId, false, 5),
      remindersWithCustomers(ownerId, true),
      inventorySummary(ownerId),
      cashSummary(ownerId),
      db.select().from(cashTransactions).where(eq(cashTransactions.ownerId, ownerId)),
      db.select({ status: visits.status, executionOutcome: visits.executionOutcome }).from(visits).where(and(eq(visits.ownerId, ownerId), isNotNull(visits.assignedTechnicianId))),
    ]);
    const visitCustomerIds = Array.from(new Set([...todayVisits, ...upcomingVisits].map(visit => visit.customerId)));
    const [visitCustomers, allCustomers] = await Promise.all([
      visitCustomerIds.length
        ? db.select().from(customers).where(and(eq(customers.ownerId, ownerId), inArray(customers.id, visitCustomerIds)))
        : Promise.resolve([]),
db.select({ id: customers.id, createdAt: customers.createdAt }).from(customers).where(eq(customers.ownerId, ownerId)),
      ]);
      const customerById = new Map(visitCustomers.map(customer => [customer.id, customer]));
      const customerNumbers = customerNumberMap([...allCustomers].sort(compareCustomersByCreation));
    const chartDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(startOfToday);
      date.setDate(date.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date: key, expenses: 0, newCustomers: 0 };
    });
    const chartByDate = new Map(chartDays.map(day => [day.date, day]));
    for (const customer of allCustomers) {
      const createdAt = new Date(customer.createdAt);
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
      const day = chartByDate.get(key);
      if (day) day.newCustomers += 1;
    }
    for (const transaction of chartTransactions) {
      if (transaction.transactionType !== "expense") continue;
      const transactionDate = new Date(transaction.transactionDate);
      const key = `${transactionDate.getFullYear()}-${String(transactionDate.getMonth() + 1).padStart(2, "0")}-${String(transactionDate.getDate()).padStart(2, "0")}`;
      const day = chartByDate.get(key);
      if (day) day.expenses += transaction.amount;
    }
    const lowStock = inventory.items.filter(item => item.currentBalance <= 2);
    const workOrderSummary = workOrderRows.reduce((summary, row) => {
      if (row.status === "completed") summary.completed += 1;
      else if (row.status === "postponed" || row.status === "cancelled" || row.executionOutcome === "not_completed") summary.notCompleted += 1;
      else if (["en_route", "arrived", "in_progress"].includes(row.status)) summary.inProgress += 1;
      else summary.assigned += 1;
      summary.total += 1;
      return summary;
    }, { total: 0, assigned: 0, inProgress: 0, completed: 0, notCompleted: 0 });
    return {
      todayVisits: todayVisits.map(visit => {
        const customer = customerById.get(visit.customerId);
        return { ...visit, customer: customer ? { ...customer, customerCode: customerCode(customerNumbers.get(customer.id) ?? customer.id) } : null };
      }),
      upcomingVisits: upcomingVisits.map(visit => {
        const customer = customerById.get(visit.customerId);
        return { ...visit, customer: customer ? { ...customer, customerCode: customerCode(customerNumbers.get(customer.id) ?? customer.id) } : null };
      }),
      upcomingFollowUps,
      dueReminders,
      customerCount: allCustomers.length,
      inventory: {
        totalItems: inventory.items.length,
        lowStockCount: lowStock.length,
        lowStock,
        items: inventory.items.map(item => ({ id: item.id, name: item.name, currentBalance: item.currentBalance, reorderLevel: item.reorderLevel })),
      },
      cash: { incomeTotal: cash.incomeTotal, expenseTotal: cash.expenseTotal, balance: cash.balance, summaries: cash.summaries },
      workOrderSummary,
      chart: { days: chartDays, generatedAt: new Date() },
    };
  }),

  reports: router({
    monthly: protectedProcedure.input(z.object({
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      technician: z.string().trim().max(160).optional(),
      transactionType: z.enum(["all", "income", "expense"]).default("all"),
      category: z.string().trim().max(160).optional(),
    })).query(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const from = new Date(`${input.dateFrom}T00:00:00`);
      const to = new Date(`${input.dateTo}T23:59:59.999`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الفترة الزمنية غير صحيحة." });
      }
      const ownerId = ctx.user.id;
      const [periodVisits, periodCash, periodMovements, pendingReminders, inventory, allCash] = await Promise.all([
        db.select().from(visits).where(and(eq(visits.ownerId, ownerId), gte(visits.visitDate, from), lte(visits.visitDate, to))).orderBy(desc(visits.visitDate)),
        db.select().from(cashTransactions).where(and(eq(cashTransactions.ownerId, ownerId), gte(cashTransactions.transactionDate, from), lte(cashTransactions.transactionDate, to))).orderBy(desc(cashTransactions.transactionDate)),
        db.select().from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), gte(inventoryMovements.movementDate, from), lte(inventoryMovements.movementDate, to))).orderBy(desc(inventoryMovements.movementDate)),
        db.select().from(reminders).where(and(eq(reminders.ownerId, ownerId), eq(reminders.status, "pending"), lte(reminders.reminderDate, to))).orderBy(asc(reminders.reminderDate)),
        inventorySummary(ownerId),
        db.select().from(cashTransactions).where(eq(cashTransactions.ownerId, ownerId)),
      ]);
      const customerIds = Array.from(new Set(periodVisits.map(visit => visit.customerId)));
      const periodCustomers = customerIds.length ? await db.select().from(customers).where(and(eq(customers.ownerId, ownerId), inArray(customers.id, customerIds))) : [];
      const customerNames = new Map(periodCustomers.map(customer => [customer.id, customer.name]));
      const sourceVisitIds = Array.from(new Set(periodCash.map(transaction => transaction.sourceVisitId).filter((id): id is number => Boolean(id))));
      const sourceVisits = sourceVisitIds.length ? await db.select({ id: visits.id, technicianName: visits.technicianName }).from(visits).where(and(eq(visits.ownerId, ownerId), inArray(visits.id, sourceVisitIds))) : [];
      const technicianByVisitId = new Map(sourceVisits.map(visit => [visit.id, visit.technicianName]));
      const periodCashWithTechnician = periodCash.map(transaction => {
        const technicianName = transaction.sourceVisitId ? technicianByVisitId.get(transaction.sourceVisitId) : undefined;
        return technicianName !== undefined ? { ...transaction, recipientName: technicianName } : transaction;
      });
      const filteredPeriodCash = periodCashWithTechnician.filter(transaction =>
        (!input.technician || (transaction.recipientName ?? "").trim() === input.technician)
        && (!input.transactionType || input.transactionType === "all" || transaction.transactionType === input.transactionType)
        && (!input.category || (transaction.category ?? "") === input.category)
      );
      const income = periodCash.filter(transaction => transaction.transactionType === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
      const expense = periodCash.filter(transaction => transaction.transactionType === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
      const filteredIncome = filteredPeriodCash.filter(transaction => transaction.transactionType === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
      const filteredExpense = filteredPeriodCash.filter(transaction => transaction.transactionType === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
      const financial = calculateCompanyFinancialOverview(periodCash);
      const treasuryBalance = calculateCashSummaries(allCash).SAR.balance;
      const groupMoney = (rows: typeof periodCash, key: (row: typeof periodCash[number]) => string) => Array.from(rows.reduce((map, row) => map.set(key(row) || "غير مصنف", (map.get(key(row) || "غير مصنف") ?? 0) + row.amount), new Map<string, number>())).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
      const groupVisits = Array.from(periodVisits.reduce((map, visit) => map.set(visit.visitType, (map.get(visit.visitType) ?? 0) + 1), new Map<string, number>())).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
      const technicianVisits = Array.from(periodVisits.reduce((map, visit) => { const label = visit.technicianName?.trim() || "غير محدد"; return map.set(label, (map.get(label) ?? 0) + 1); }, new Map<string, number>())).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
      return {
        period: { dateFrom: input.dateFrom, dateTo: input.dateTo },
        summary: { visits: periodVisits.length, customers: customerIds.length, income, expense, balance: income - expense, treasuryBalance, pendingReminders: pendingReminders.length, lowStock: inventory.items.filter(item => item.currentBalance <= 2).length },
        financial: { serviceIncome: financial.serviceIncome, externalIncome: financial.externalIncome, totalIncome: financial.totalIncome, technicianPayments: financial.technicianPayments, technicianRequired: financial.technicianRequired, technicianRemaining: financial.technicianRemaining, otherExpenses: financial.otherExpenses, gasolineExpenses: financial.gasolineExpenses, inventoryPurchaseExpenses: financial.inventoryPurchaseExpenses, generalExpenses: financial.generalExpenses, uncategorizedExpenses: financial.uncategorizedExpenses, companyNet: financial.companyNet, technicianPaymentsByName: financial.technicianPaymentsByName },
        incomeByCategory: groupMoney(periodCash.filter(transaction => transaction.transactionType === "income"), row => row.category),
        expenseByCategory: groupMoney(periodCash.filter(transaction => transaction.transactionType === "expense"), row => row.category),
        treasury: {
          transactions: filteredPeriodCash,
          incomeTotal: filteredIncome,
          expenseTotal: filteredExpense,
          balance: filteredIncome - filteredExpense,
          selectedTechnician: input.technician ?? "",
          selectedTransactionType: input.transactionType,
          selectedCategory: input.category ?? "",
          availableTechnicians: Array.from(new Set(periodCashWithTechnician.map(row => row.recipientName).filter((name): name is string => Boolean(name?.trim())))).sort((a, b) => a.localeCompare(b, "ar")),
          availableCategories: Array.from(new Set(periodCashWithTechnician.map(row => row.category).filter((category): category is string => Boolean(category?.trim())))).sort((a, b) => a.localeCompare(b, "ar")),
        },
        visitsByType: groupVisits,
        visitsByTechnician: technicianVisits,
        inventory: { incomingQuantity: periodMovements.filter(movement => movement.movementType === "incoming").reduce((sum, movement) => sum + movement.quantity, 0), outgoingQuantity: periodMovements.filter(movement => movement.movementType === "outgoing").reduce((sum, movement) => sum + movement.quantity, 0), purchaseCost: periodMovements.filter(movement => movement.movementType === "incoming").reduce((sum, movement) => sum + movement.quantity * movement.unitCost, 0), items: inventory.items.map(item => ({ name: item.name, currentBalance: item.currentBalance })) },
        recentVisits: periodVisits.slice(0, 12).map(visit => ({ date: visit.visitDate, type: visit.visitType, technician: visit.technicianName || "غير محدد", customer: customerNames.get(visit.customerId) || "عميل غير معروف" })),
      };
    }),
  }),

  customers: router({
    list: protectedProcedure.input(z.object({
      search: z.string().trim().max(160).optional(),
      followUpStatus: z.enum(["all", "overdue", "today", "within_5_days", "more_than_5_days", "upcoming", "regular", "none"]).default("all"),
      followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      visitDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      visitDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      collectedAmountMin: z.number().int().nonnegative().optional(),
      collectedAmountMax: z.number().int().nonnegative().optional(),
      sortBy: z.enum(["created_desc", "next_asc", "next_desc", "status", "collected_desc", "collected_asc"]).default("created_desc"),
    })).query(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const ownerFilter = eq(customers.ownerId, ownerId);
      const [customerRows, ownerVisits] = await Promise.all([
        db.select().from(customers).where(ownerFilter).orderBy(desc(customers.createdAt)),
        db.select().from(visits).where(eq(visits.ownerId, ownerId)).orderBy(desc(visits.visitDate)),
      ]);
      const visitIds = ownerVisits.map(visit => visit.id);
      const ownerIncome = visitIds.length
        ? await db.select().from(cashTransactions).where(and(eq(cashTransactions.ownerId, ownerId), eq(cashTransactions.transactionType, "income"), inArray(cashTransactions.sourceVisitId, visitIds)))
        : [];
      const customerNumbers = customerNumberMap([...customerRows].sort(compareCustomersByCreation));
      const visitsByCustomer = new Map<number, Array<typeof visits.$inferSelect>>();
      ownerVisits.forEach(visit => visitsByCustomer.set(visit.customerId, [...(visitsByCustomer.get(visit.customerId) ?? []), visit]));
      const incomeByVisit = new Map(ownerIncome.map(transaction => [transaction.sourceVisitId, transaction]));
      const totalIncomeByCustomer = new Map<number, number>();
      ownerIncome.forEach(transaction => {
        if (transaction.sourceVisitId === null) return;
        const visit = ownerVisits.find(item => item.id === transaction.sourceVisitId);
        if (visit) totalIncomeByCustomer.set(visit.customerId, (totalIncomeByCustomer.get(visit.customerId) ?? 0) + transaction.amount);
      });
      const search = input.search?.toLocaleLowerCase("ar-EG");
      return customerRows
        .map(customer => {
          const shaped = withCustomerFollowUp(customer, visitsByCustomer.get(customer.id) ?? [], customerNumbers.get(customer.id) ?? customer.id);
          const latestVisit = (visitsByCustomer.get(customer.id) ?? [])[0];
          const latestIncome = latestVisit ? incomeByVisit.get(latestVisit.id) : undefined;
          return {
            ...shaped,
            lastVisitDate: latestVisit?.visitDate ?? null,
            latestTechnicianName: latestVisit?.technicianName ?? null,
            latestTdsIn: latestVisit?.tdsIn ?? null,
            latestTdsOut: latestVisit?.tdsOut ?? null,
            collectedAmount: latestIncome?.amount ?? 0,
            totalCollectedAmount: totalIncomeByCustomer.get(customer.id) ?? 0,
            collectedCurrency: latestIncome?.currency ?? "SAR",
          };
        })
        .filter(customer => {
          const matchesSearch = !search || customer.name.toLocaleLowerCase("ar-EG").includes(search) || customer.phone.includes(search) || (customer.customerCode ?? "").toLowerCase().includes(search);
          const followUp = customer.followUp;
          const matchesStatus = input.followUpStatus === "all"
            || (input.followUpStatus === "none" && !followUp)
            || (input.followUpStatus === "overdue" && Boolean(followUp && followUp.daysRemaining < 0))
            || (input.followUpStatus === "today" && Boolean(followUp && followUp.daysRemaining === 0))
            || (input.followUpStatus === "within_5_days" && Boolean(followUp && followUp.daysRemaining > 0 && followUp.daysRemaining <= 5))
            || (input.followUpStatus === "more_than_5_days" && Boolean(followUp && followUp.daysRemaining > 5))
            || (input.followUpStatus === "upcoming" && Boolean(followUp && followUp.daysRemaining <= 5))
            || (input.followUpStatus === "regular" && Boolean(followUp && followUp.daysRemaining > 5));
          const lastVisitDate = customer.lastVisitDate?.toISOString().slice(0, 10);
          const matchesDate = !input.followUpDate || Boolean(followUp && followUp.nextVisitDate.toISOString().slice(0, 10) === input.followUpDate);
          const matchesVisitDateFrom = !input.visitDateFrom || Boolean(lastVisitDate && lastVisitDate >= input.visitDateFrom);
          const matchesVisitDateTo = !input.visitDateTo || Boolean(lastVisitDate && lastVisitDate <= input.visitDateTo);
          const matchesCollectedMin = input.collectedAmountMin === undefined || customer.totalCollectedAmount >= input.collectedAmountMin;
          const matchesCollectedMax = input.collectedAmountMax === undefined || customer.totalCollectedAmount <= input.collectedAmountMax;
          return matchesSearch && matchesStatus && matchesDate && matchesVisitDateFrom && matchesVisitDateTo && matchesCollectedMin && matchesCollectedMax;
        })
        .sort((left, right) => {
          if (input.sortBy === "next_asc" || input.sortBy === "next_desc") {
            const leftDate = left.followUp?.nextVisitDate.getTime();
            const rightDate = right.followUp?.nextVisitDate.getTime();
            if (leftDate === undefined || rightDate === undefined) return leftDate === rightDate ? 0 : leftDate === undefined ? 1 : -1;
            return (input.sortBy === "next_asc" ? 1 : -1) * (leftDate - rightDate);
          }
          if (input.sortBy === "status") {
            const statusRank = (customer: typeof left) => !customer.followUp ? 5 : customer.followUp.daysRemaining < 0 ? 1 : customer.followUp.daysRemaining === 0 ? 2 : customer.followUp.daysRemaining <= 5 ? 3 : 4;
            return statusRank(left) - statusRank(right) || left.name.localeCompare(right.name, "ar-EG");
          }
          if (input.sortBy === "collected_desc" || input.sortBy === "collected_asc") {
            const difference = left.totalCollectedAmount - right.totalCollectedAmount;
            return (input.sortBy === "collected_desc" ? -1 : 1) * difference || left.name.localeCompare(right.name, "ar-EG");
          }
          return left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id;
        });
    }),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const customer = await getOwnedCustomer(ownerId, input.id);
      const allCustomers = await db.select().from(customers).where(eq(customers.ownerId, ownerId));
      const customerNumbers = customerNumberMap((Array.isArray(allCustomers) ? allCustomers : [customer]).slice().sort(compareCustomersByCreation));
      const [customerVisits, customerReminders] = await Promise.all([
        db.select().from(visits).where(and(eq(visits.ownerId, ownerId), eq(visits.customerId, input.id))).orderBy(desc(visits.visitDate)),
        db.select().from(reminders).where(and(eq(reminders.ownerId, ownerId), eq(reminders.customerId, input.id))).orderBy(desc(reminders.reminderDate)),
      ]);
      return { customer: withCustomerFollowUp(customer, customerVisits, customerNumbers.get(customer.id) ?? customer.id), visits: customerVisits, reminders: customerReminders };
    }),
    create: protectedProcedure.input(customerCreateInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      if (input.clientOperationId) {
        const existing = await db.select().from(customers).where(and(
          eq(customers.ownerId, ownerId),
          eq(customers.clientOperationId, input.clientOperationId),
        )).limit(1);
        if (existing[0]) return { id: existing[0].id, alreadySynced: true };
      }
      const { clientOperationId, firstVisitType, firstVisitDate, followUpDays, firstTechnicianName, firstTechnicianId, firstSalesAgentName, firstFilterCount, firstTdsIn, firstTdsOut, firstVisitResult, firstVisitNotes, firstCollectedAmount, firstCollectedCurrency, items, ...data } = input;
      const assignedTechnician = await resolveAssignedTechnician(ownerId, ctx.user.role === "user" ? ctx.user.id : null, firstTechnicianId, firstTechnicianName);
      const storedTechnicianName = assignedTechnician?.name ?? firstTechnicianName ?? null;
      const existingNames = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.ownerId, ownerId)).limit(100000);
      if (existingNames.some(customer => normalizeCustomerName(customer.name) === normalizeCustomerName(data.name))) {
        throw new TRPCError({ code: "CONFLICT", message: "اسم العميل موجود بالفعل، استخدم اسمًا مختلفًا." });
      }
      if (data.manualCode) {
        const duplicate = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.ownerId, ownerId), eq(customers.manualCode, data.manualCode))).limit(1);
        if (duplicate[0]) throw new TRPCError({ code: "CONFLICT", message: "كود العميل مستخدم بالفعل، اختر كودًا مختلفًا." });
      }
      const result = await db.insert(customers).values({ ...data, clientOperationId, ownerId });
      const customerId = Number(result[0].insertId);
      if (!firstVisitType) {
        await refreshOwnerBackup(ownerId);
        return { id: customerId, alreadySynced: false, firstVisitCreated: false };
      }
      const visitDate = firstVisitDate ?? new Date();
      const shouldCreateFollowUp = needsAutomaticReminder(firstVisitType) || followUpDays !== undefined;
      const nextVisitDate = shouldCreateFollowUp ? followUpDate(visitDate, followUpDays) : null;
      const visitResult = await db.insert(visits).values({ customerId, ownerId, visitType: firstVisitType, visitDate, nextVisitDate, technicianName: storedTechnicianName, assignedTechnicianId: assignedTechnician?.id ?? null, salesAgentName: firstSalesAgentName ?? null, filterCount: firstFilterCount, tdsIn: firstTdsIn ?? null, tdsOut: firstTdsOut ?? null, visitResult: firstVisitResult ?? null, notes: firstVisitNotes ?? null });
      const visitId = Number(visitResult[0].insertId);
      const inventoryRows = items.length ? await db.select().from(inventoryItems).where(and(eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, items.map(item => item.inventoryItemId)))) : [];
      const inventoryById = new Map(inventoryRows.map(item => [item.id, item]));
      for (const requested of items) {
        const inventoryItem = inventoryById.get(requested.inventoryItemId);
        if (!inventoryItem) throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على أحد الأصناف المستخدمة." });
        const movements = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.inventoryItemId, requested.inventoryItemId)));
        const balance = calculateStockBalance(inventoryItem.openingQuantity, movements);
        if (requested.quantity > balance) throw new TRPCError({ code: "BAD_REQUEST", message: `الرصيد غير كافٍ من صنف ${inventoryItem.name}؛ المتاح ${balance} والمطلوب ${requested.quantity}.` });
      }
      for (const requested of items) {
        const inventoryItem = inventoryById.get(requested.inventoryItemId)!;
        const operationId = clientOperationId ? `${clientOperationId}:${requested.inventoryItemId}`.slice(0, 64) : undefined;
        await db.insert(visitItems).values({ ownerId, visitId, inventoryItemId: inventoryItem.id, itemNameSnapshot: inventoryItem.name, unitSnapshot: inventoryItem.unit, quantity: requested.quantity, source: requested.source, clientOperationId: operationId });
        await db.insert(inventoryMovements).values({ ownerId, inventoryItemId: inventoryItem.id, movementType: "outgoing", quantity: requested.quantity, unitCost: inventoryItem.defaultUnitCost, currency: "SAR", movementDate: visitDate, technicianName: storedTechnicianName, customerId, notes: `منصرف تلقائي من أول زيارة للعميل ${input.name}`, clientOperationId: operationId });
      }
      if (nextVisitDate) {
        await db.insert(reminders).values({ customerId, visitId, ownerId, reminderDate: nextVisitDate });
      }
      if (firstCollectedAmount > 0) {
        const category = firstVisitType === "installation" ? "تحصيل تركيب" : firstVisitType === "maintenance" ? "تحصيل صيانة" : firstVisitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
        await db.insert(cashTransactions).values({ ownerId, transactionType: "income", currency: firstCollectedCurrency, amount: firstCollectedAmount, category, transactionDate: visitDate, sourceVisitId: visitId, recipientName: storedTechnicianName, notes: storedTechnicianName ? `العميل: ${input.name} | إيراد أُنشئ تلقائيًا من أول زيارة بواسطة ${storedTechnicianName}` : `العميل: ${input.name} | إيراد أُنشئ تلقائيًا من أول زيارة` });
      }
      await refreshOwnerBackup(ownerId);
      return { id: customerId, alreadySynced: false, firstVisitCreated: true, reminderCreated: Boolean(nextVisitDate) };
    }),
    importBulk: protectedProcedure.input(z.object({ rows: z.array(customerImportRowInput).min(1).max(1000) })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const existingRows = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, manualCode: customers.manualCode }).from(customers).where(eq(customers.ownerId, ownerId));
      const names = new Set(existingRows.map(row => normalizeCustomerName(row.name)));
      const phones = new Set(existingRows.map(row => row.phone.trim()));
      const codes = new Set(existingRows.map(row => row.manualCode?.trim()).filter(Boolean) as string[]);
      const customerByCode = new Map(existingRows.map(row => [row.manualCode?.trim(), row.id]).filter((entry): entry is [string, number] => Boolean(entry[0])));
      const customerByPhone = new Map(existingRows.map(row => [row.phone.trim(), row.id]));
      const rejected: Array<{ rowNumber: number; reason: string }> = [];
      let added = 0;
      let linked = 0;
      let visitsAdded = 0;
      let incomeAdded = 0;
      for (const row of input.rows) {
        const name = row.name.trim().replace(/\\s+/g, " ");
        const phone = row.phone.trim();
        const manualCode = row.manualCode?.trim() || null;
        const normalizedName = normalizeCustomerName(name);
        const linkedCustomerId = manualCode ? customerByCode.get(manualCode) : customerByPhone.get(phone);
        if (!linkedCustomerId && names.has(normalizedName)) { rejected.push({ rowNumber: row.rowNumber, reason: "اسم العميل موجود بالفعل مع رقم مختلف — استخدم كود العميل أو راجع الصف قبل الاستيراد" }); continue; }
        let assignedTechnician: Awaited<ReturnType<typeof resolveAssignedTechnician>> = null;
        if (row.visitType && row.visitDate && row.technicianName?.trim()) {
          try {
            assignedTechnician = await resolveAssignedTechnician(ownerId, ctx.user.role === "user" ? ctx.user.id : null, null, row.technicianName);
          } catch (error) {
            if (error instanceof TRPCError && error.code === "NOT_FOUND") {
              rejected.push({ rowNumber: row.rowNumber, reason: "الفني المستورد غير مرتبط بحساب فني نشط في الشركة" });
              continue;
            }
            throw error;
          }
        }
        if (manualCode && codes.has(manualCode) && !linkedCustomerId) { rejected.push({ rowNumber: row.rowNumber, reason: "كود العميل مستخدم بالفعل" }); continue; }
        if (row.visitType && !row.visitDate) { rejected.push({ rowNumber: row.rowNumber, reason: "لا يمكن إنشاء الزيارة دون تاريخ" }); continue; }
        const location = row.location?.trim() || "";
        const coordinates = location.match(/(-?\\d+(?:\\.\\d+)?)\\s*[,،]\\s*(-?\\d+(?:\\.\\d+)?)/);
        const customerId = linkedCustomerId || Number((await db.insert(customers).values({ ownerId, name, phone, manualCode, address: row.address?.trim() || null, latitude: coordinates?.[1] || null, longitude: coordinates?.[2] || null, notes: row.notes?.trim() || null }))[0].insertId);
        if (linkedCustomerId) linked += 1;
        if (!linkedCustomerId) {
          added += 1;
          names.add(normalizedName); phones.add(phone); customerByPhone.set(phone, customerId); if (manualCode) codes.add(manualCode);
          if (manualCode) customerByCode.set(manualCode, customerId);
        }
        if (row.visitType && row.visitDate) {
          const operationId = `excel-import-${row.rowNumber}`.slice(0, 64);
          const existingVisit = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.ownerId, ownerId), eq(visits.clientOperationId, operationId))).limit(1);
          let visitId = existingVisit[0]?.id;
          let visitWasCreated = false;
          if (!visitId) {
            try {
              visitId = Number((await db.insert(visits).values({ ownerId, customerId, visitType: row.visitType, visitDate: row.visitDate, technicianName: assignedTechnician?.name || row.technicianName?.trim() || null, assignedTechnicianId: assignedTechnician?.id || null, status: "completed", notes: row.notes?.trim() || null, clientOperationId: operationId }))[0].insertId);
              visitWasCreated = true;
            } catch (error) {
              const concurrentVisit = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.ownerId, ownerId), eq(visits.clientOperationId, operationId))).limit(1);
              if (!concurrentVisit[0]) throw error;
              visitId = concurrentVisit[0].id;
            }
          }
          if (visitWasCreated) {
            visitsAdded += 1;
            if (needsAutomaticReminder(row.visitType)) await db.insert(reminders).values({ customerId, visitId, ownerId, reminderDate: followUpDate(row.visitDate) });
          }
          const amount = Math.round(row.collectedAmount || 0);
          const incomeOperationId = `${operationId}:income`.slice(0, 64);
          if (amount > 0) {
            const existingIncome = await db.select({ id: cashTransactions.id }).from(cashTransactions).where(and(eq(cashTransactions.ownerId, ownerId), eq(cashTransactions.clientOperationId, incomeOperationId))).limit(1);
            if (!existingIncome[0]) {
              const category = row.visitType === "installation" ? "تحصيل تركيب" : row.visitType === "maintenance" ? "تحصيل صيانة" : row.visitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
              await db.insert(cashTransactions).values({ ownerId, transactionType: "income", currency: "SAR", amount, category, transactionDate: row.visitDate, sourceVisitId: visitId, recipientName: assignedTechnician?.name ?? row.technicianName?.trim() ?? null, clientOperationId: incomeOperationId, notes: `العميل: ${name} | إيراد مستورد من Excel` });
              incomeAdded += 1;
            }
          }
        }
      }
      if (added) await refreshOwnerBackup(ownerId);
      return { added, linked, visitsAdded, incomeAdded, rejected, total: input.rows.length, processed: added + linked + rejected.length };
    }),
    seedPerformanceCustomers: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const marker = "__PUREPOINT_PERFORMANCE_TEST__";
      const existing = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.ownerId, ctx.user.id), eq(customers.notes, marker)));
      if (existing.length) return { created: 0, existing: existing.length, marker };
      const rows = Array.from({ length: 1000 }, (_, index) => {
        const sequence = String(index + 1).padStart(4, "0");
        const latitude = (24.70 + (index % 25) * 0.002).toFixed(6);
        const longitude = (46.63 + (index % 40) * 0.002).toFixed(6);
        return { ownerId: ctx.user.id, name: `عميل تجريبي للأداء ${sequence}`, phone: `099${String(index + 1).padStart(7, "0")}`, manualCode: `PERF-${sequence}`, address: `عنوان تجريبي ${sequence}`, latitude, longitude, notes: marker };
      });
      for (let offset = 0; offset < rows.length; offset += 250) await db.insert(customers).values(rows.slice(offset, offset + 250));
      const seededCustomers = await db.select({ id: customers.id, manualCode: customers.manualCode }).from(customers).where(and(eq(customers.ownerId, ctx.user.id), eq(customers.notes, marker)));
      const visitRows = seededCustomers.map((customer, index) => {
        const sequence = String(index + 1).padStart(4, "0");
        const visitDate = new Date(Date.now() - (index % 365) * 86_400_000);
        return { customerId: customer.id, ownerId: ctx.user.id, visitType: index % 3 === 0 ? "installation" as const : index % 3 === 1 ? "maintenance" as const : "cartridge_change" as const, visitDate, technicianName: index % 2 === 0 ? "فني تجريبي" : "فني اختبار", status: "completed" as const, completedAt: visitDate, notes: marker, visitResult: "تم التنفيذ - بيانات اختبار أداء", clientOperationId: `${marker}:visit:${sequence}` };
      });
      for (let offset = 0; offset < visitRows.length; offset += 250) await db.insert(visits).values(visitRows.slice(offset, offset + 250));
      const seededVisits = await db.select({ id: visits.id, customerId: visits.customerId, visitDate: visits.visitDate }).from(visits).where(and(eq(visits.ownerId, ctx.user.id), like(visits.clientOperationId, `${marker}:visit:%`)));
      const visitByCustomer = new Map(seededVisits.map(visit => [visit.customerId, visit]));
      const cashRows = seededCustomers.flatMap((customer, index) => {
        const visit = visitByCustomer.get(customer.id);
        if (!visit) return [];
        const sequence = String(index + 1).padStart(4, "0");
        const amount = 150 + (index % 8) * 50;
        return [{ ownerId: ctx.user.id, transactionType: "income" as const, currency: "SAR" as const, amount, category: "تحصيل اختبار أداء", transactionDate: visit.visitDate, sourceVisitId: visit.id, recipientName: "فني تجريبي", clientOperationId: `${marker}:cash:${sequence}`, notes: marker }];
      });
      for (let offset = 0; offset < cashRows.length; offset += 250) await db.insert(cashTransactions).values(cashRows.slice(offset, offset + 250));
      void refreshOwnerBackup(ctx.user.id).catch(error => console.error("[PerformanceSeed] backup refresh failed", error));
      return { created: seededCustomers.length, visitsCreated: visitRows.length, cashCreated: cashRows.length, existing: 0, marker };
    }),
    deletePerformanceCustomers: protectedProcedure.input(sensitivePinInput).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const marker = "__PUREPOINT_PERFORMANCE_TEST__";
      const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.ownerId, ctx.user.id), eq(customers.notes, marker)));
      const customerIds = rows.map(row => row.id);
      const performanceVisits = customerIds.length ? await db.select({ id: visits.id }).from(visits).where(and(eq(visits.ownerId, ctx.user.id), inArray(visits.customerId, customerIds))) : [];
      const visitIds = performanceVisits.map(row => row.id);
      if (visitIds.length) await db.delete(cashTransactions).where(and(eq(cashTransactions.ownerId, ctx.user.id), inArray(cashTransactions.sourceVisitId, visitIds)));
      if (customerIds.length) await db.delete(customers).where(and(eq(customers.ownerId, ctx.user.id), inArray(customers.id, customerIds)));
      if (rows.length) void refreshOwnerBackup(ctx.user.id).catch(error => console.error("[PerformanceSeed] backup refresh failed", error));
      return { deleted: rows.length, visitsDeleted: visitIds.length };
    }),
    update: protectedProcedure.input(customerInput.extend({ id: z.number().int().positive(), pin: sensitivePinInput.shape.pin })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const customer = await getOwnedCustomer(ctx.user.id, input.id);
      const { id, serviceDate, collectedAmount, pin: _pin, ...data } = input;
      const existingNames = await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.ownerId, ctx.user.id), ne(customers.id, id))).limit(100000);
      if (existingNames.some(customer => normalizeCustomerName(customer.name) === normalizeCustomerName(data.name))) {
        throw new TRPCError({ code: "CONFLICT", message: "اسم العميل موجود بالفعل، استخدم اسمًا مختلفًا." });
      }
      if (data.manualCode) {
        const duplicate = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.ownerId, ctx.user.id), eq(customers.manualCode, data.manualCode), ne(customers.id, id))).limit(1);
        if (duplicate[0]) throw new TRPCError({ code: "CONFLICT", message: "كود العميل مستخدم بالفعل، اختر كودًا مختلفًا." });
      }
      await db.update(customers).set(data).where(and(eq(customers.id, id), eq(customers.ownerId, ctx.user.id)));
      if (collectedAmount !== undefined && collectedAmount !== null) {
        const latestForAmount = await db.select().from(visits).where(and(eq(visits.customerId, id), eq(visits.ownerId, ctx.user.id))).orderBy(desc(visits.visitDate)).limit(1);
        if (latestForAmount[0]) {
          const linkedIncome = await db.select().from(cashTransactions).where(and(eq(cashTransactions.sourceVisitId, latestForAmount[0].id), eq(cashTransactions.ownerId, ctx.user.id))).limit(1);
          if (linkedIncome[0]) {
            await db.update(cashTransactions).set({ amount: collectedAmount }).where(and(eq(cashTransactions.id, linkedIncome[0].id), eq(cashTransactions.ownerId, ctx.user.id)));
          } else if (collectedAmount > 0) {
            const category = latestForAmount[0].visitType === "installation" ? "تحصيل تركيب" : latestForAmount[0].visitType === "maintenance" ? "تحصيل صيانة" : latestForAmount[0].visitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
            await db.insert(cashTransactions).values({ ownerId: ctx.user.id, transactionType: "income", currency: "SAR", amount: collectedAmount, category, transactionDate: latestForAmount[0].visitDate, sourceVisitId: latestForAmount[0].id, recipientName: latestForAmount[0].technicianName ?? null, notes: latestForAmount[0].technicianName ? `العميل: ${customer.name} | إيراد أُنشئ من تعديل مبلغ الخدمة بواسطة ${latestForAmount[0].technicianName}` : `العميل: ${customer.name} | إيراد أُنشئ من تعديل مبلغ الخدمة` });
          }
        }
      }
      if (serviceDate) {
        const latestVisit = await db.select().from(visits).where(and(eq(visits.customerId, id), eq(visits.ownerId, ctx.user.id))).orderBy(desc(visits.visitDate)).limit(1);
        if (latestVisit[0]) {
          await db.update(visits).set({ visitDate: serviceDate }).where(and(eq(visits.id, latestVisit[0].id), eq(visits.ownerId, ctx.user.id)));
          if (needsAutomaticReminder(latestVisit[0].visitType)) {
            await db.update(reminders).set({ reminderDate: followUpDate(serviceDate) }).where(and(eq(reminders.visitId, latestVisit[0].id), eq(reminders.ownerId, ctx.user.id), eq(reminders.status, "pending")));
          }
          await db.update(cashTransactions).set({ transactionDate: serviceDate }).where(and(eq(cashTransactions.sourceVisitId, latestVisit[0].id), eq(cashTransactions.ownerId, ctx.user.id)));
        }
      }
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    deleteAll: protectedProcedure.input(sensitivePinInput.extend({ confirmation: z.literal("حذف جميع العملاء") })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const ownedCustomers = await db.select({ id: customers.id }).from(customers).where(eq(customers.ownerId, ctx.user.id));
      const customerIds = ownedCustomers.map(customer => customer.id);
      if (!customerIds.length) return { success: true, deletedCustomers: 0, deletedVisits: 0, deletedReminders: 0 };
      const ownedVisits = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.ownerId, ctx.user.id), inArray(visits.customerId, customerIds)));
      const visitIds = ownedVisits.map(visit => visit.id);
      const ownedReminders = visitIds.length ? await db.select({ id: reminders.id }).from(reminders).where(and(eq(reminders.ownerId, ctx.user.id), inArray(reminders.visitId, visitIds))) : [];
      if (ownedReminders.length) await db.delete(reminders).where(and(eq(reminders.ownerId, ctx.user.id), inArray(reminders.id, ownedReminders.map(reminder => reminder.id))));
      if (visitIds.length) await db.delete(visits).where(and(eq(visits.ownerId, ctx.user.id), inArray(visits.id, visitIds)));
      await db.delete(customers).where(and(eq(customers.ownerId, ctx.user.id), inArray(customers.id, customerIds)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true, deletedCustomers: customerIds.length, deletedVisits: visitIds.length, deletedReminders: ownedReminders.length };
    }),
    deleteAllData: protectedProcedure.input(sensitivePinInput.extend({ confirmation: z.literal("مسح كل بيانات التطبيق") })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const ownerWhere = (table: any) => eq(table.ownerId, ctx.user.id);
      const count = async (table: any, idColumn: any) => (await db.select({ id: idColumn }).from(table).where(ownerWhere(table))).length;
      const deleted = {
        customers: await count(customers, customers.id),
        visits: await count(visits, visits.id),
        reminders: await count(reminders, reminders.id),
        cashTransactions: await count(cashTransactions, cashTransactions.id),
        inventoryItems: await count(inventoryItems, inventoryItems.id),
        inventoryMovements: await count(inventoryMovements, inventoryMovements.id),
        serviceTypes: await count(serviceTypes, serviceTypes.id),
        serviceTypeItems: await count(serviceTypeItems, serviceTypeItems.id),
        visitItems: await count(visitItems, visitItems.id),
        workOrderProofs: await count(workOrderProofs, workOrderProofs.id),
        technicianLocations: await count(technicianLocations, technicianLocations.id),
      };
      await db.delete(workOrderProofs).where(ownerWhere(workOrderProofs));
      await db.delete(visitItems).where(ownerWhere(visitItems));
      await db.delete(reminders).where(ownerWhere(reminders));
      await db.delete(cashTransactions).where(ownerWhere(cashTransactions));
      await db.delete(visits).where(ownerWhere(visits));
      await db.delete(serviceTypeItems).where(ownerWhere(serviceTypeItems));
      await db.delete(serviceTypes).where(ownerWhere(serviceTypes));
      await db.delete(inventoryMovements).where(ownerWhere(inventoryMovements));
      await db.delete(inventoryItems).where(ownerWhere(inventoryItems));
      await db.delete(technicianLocations).where(ownerWhere(technicianLocations));
      await db.delete(customers).where(ownerWhere(customers));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true, deleted };
    }),
    delete: protectedProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await getOwnedCustomer(ctx.user.id, input.id);
      await db.delete(customers).where(and(eq(customers.id, input.id), eq(customers.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),

  serviceTypes: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const existing = await db.select().from(serviceTypes).where(eq(serviceTypes.ownerId, ownerId));
      if (!existing.length) {
        await db.insert(serviceTypes).values(visitTypes.map(code => ({ ownerId, code, name: code === "installation" ? "تركيب فلتر" : code === "maintenance" ? "صيانة" : code === "cartridge_change" ? "تغيير شمعات" : code === "follow_up" ? "متابعة" : "أخرى" })));
      }
      const types = existing.length ? existing : await db.select().from(serviceTypes).where(eq(serviceTypes.ownerId, ownerId));
      const mappings = types.length ? await db.select().from(serviceTypeItems).where(and(eq(serviceTypeItems.ownerId, ownerId), inArray(serviceTypeItems.serviceTypeId, types.map(type => type.id)))) : [];
      const inventory = await inventorySummary(ownerId);
      const items = inventory.items.map(item => ({ id: item.id, name: item.name, unit: item.unit, currentBalance: item.currentBalance }));
      return { types, mappings, items };
    }),
    saveMapping: adminProcedure.input(z.object({ serviceTypeId: z.number().int().positive(), inventoryItemId: z.number().int().positive(), defaultQuantity: z.number().int().positive(), isRequired: z.boolean().default(false), allowEditQuantity: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const service = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(and(eq(serviceTypes.id, input.serviceTypeId), eq(serviceTypes.ownerId, ctx.user.id))).limit(1);
      const item = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, input.inventoryItemId), eq(inventoryItems.ownerId, ctx.user.id))).limit(1);
      if (!service[0] || !item[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الخدمة أو الصنف غير موجود." });
      await db.insert(serviceTypeItems).values({ ownerId: ctx.user.id, ...input }).onDuplicateKeyUpdate({ set: { defaultQuantity: input.defaultQuantity, isRequired: input.isRequired, allowEditQuantity: input.allowEditQuantity } });
      await db.update(serviceTypes).set({ version: 1 }).where(eq(serviceTypes.id, input.serviceTypeId));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),

  visits: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const [visitRows, customerRows, incomeRows] = await Promise.all([
        db.select().from(visits).where(eq(visits.ownerId, ownerId)).orderBy(desc(visits.visitDate)),
        db.select().from(customers).where(eq(customers.ownerId, ownerId)),
        db.select().from(cashTransactions).where(and(eq(cashTransactions.ownerId, ownerId), eq(cashTransactions.transactionType, "income"))),
      ]);
      const customerById = new Map(customerRows.map(customer => [customer.id, customer]));
      const incomeByVisit = new Map(incomeRows.filter(row => row.sourceVisitId).map(row => [row.sourceVisitId!, row]));
      return visitRows.map(visit => {
        const customer = customerById.get(visit.customerId);
        const income = incomeByVisit.get(visit.id);
        return {
          ...visit,
          customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, address: customer.address, latitude: customer.latitude, longitude: customer.longitude, manualCode: customer.manualCode } : null,
          collectedAmount: income?.amount ?? 0,
          collectedCurrency: income?.currency ?? "SAR",
        };
      });
    }),
    create: protectedProcedure.input(visitInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      if (input.clientOperationId) {
        const existing = await db.select().from(visits).where(and(
          eq(visits.ownerId, ownerId),
          eq(visits.clientOperationId, input.clientOperationId),
        )).limit(1);
        if (existing[0]) {
          return {
            id: existing[0].id,
            reminderCreated: needsAutomaticReminder(existing[0].visitType),
            alreadySynced: true,
          };
        }
      }
      const customer = await getOwnedCustomer(ownerId, input.customerId);
      const { clientOperationId, collectedAmount, collectedCurrency, items, phone: _phone, followUpDays: requestedFollowUpDays, technicianName: inputTechnicianName, assignedTechnicianId: requestedTechnicianId, ...visitData } = input;
      const shouldCreateFollowUp = needsAutomaticReminder(input.visitType) || requestedFollowUpDays !== undefined || input.nextVisitDate != null;
      const reminderDate = shouldCreateFollowUp
        ? input.nextVisitDate ?? followUpDate(input.visitDate, requestedFollowUpDays)
        : null;
      const assignedTechnician = await resolveAssignedTechnician(ownerId, ctx.user.role === "user" ? ctx.user.id : null, requestedTechnicianId, inputTechnicianName);
      const storedTechnicianName = assignedTechnician?.name ?? inputTechnicianName ?? null;
      const inventoryRows = items.length ? await db.select().from(inventoryItems).where(and(eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, items.map(item => item.inventoryItemId)))) : [];
      const inventoryById = new Map(inventoryRows.map(item => [item.id, item]));
      for (const requested of items) {
        const inventoryItem = inventoryById.get(requested.inventoryItemId);
        if (!inventoryItem) throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على أحد الأصناف المستخدمة." });
        const movements = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.inventoryItemId, requested.inventoryItemId)));
        const balance = calculateStockBalance(inventoryItem.openingQuantity, movements);
        if (requested.quantity > balance) throw new TRPCError({ code: "BAD_REQUEST", message: `الرصيد غير كافٍ من صنف ${inventoryItem.name}؛ المتاح ${balance} والمطلوب ${requested.quantity}.` });
      }
      const visitResult = await db.insert(visits).values({ ...visitData, nextVisitDate: reminderDate, ownerId, technicianName: storedTechnicianName, assignedTechnicianId: assignedTechnician?.id ?? null, clientOperationId });
      const visitId = Number(visitResult[0].insertId);
      for (const requested of items) {
        const inventoryItem = inventoryById.get(requested.inventoryItemId)!;
        const operationId = clientOperationId ? `${clientOperationId}:${requested.inventoryItemId}`.slice(0, 64) : undefined;
        await db.insert(visitItems).values({ ownerId, visitId, inventoryItemId: inventoryItem.id, itemNameSnapshot: inventoryItem.name, unitSnapshot: inventoryItem.unit, quantity: requested.quantity, source: requested.source, clientOperationId: operationId });
        await db.insert(inventoryMovements).values({ ownerId, inventoryItemId: inventoryItem.id, customerId: input.customerId, movementType: "outgoing", quantity: requested.quantity, unitCost: inventoryItem.defaultUnitCost, currency: "SAR", movementDate: input.visitDate, technicianName: storedTechnicianName, notes: `منصرف تلقائي من زيارة العميل ${customer.name}`, clientOperationId: operationId });
      }
      // تسجيل الزيارة يعني أن متابعة العميل تمت؛ لا نُبقي أي تذكير سابق معلقًا.
      await db.update(reminders)
        .set({ status: "completed" })
        .where(and(
          eq(reminders.ownerId, ownerId),
          eq(reminders.customerId, input.customerId),
          eq(reminders.status, "pending"),
        ));
      if (shouldCreateFollowUp) {
        await db.insert(reminders).values({
          customerId: input.customerId,
          visitId,
          ownerId,
          reminderDate: reminderDate!,
        });
      }
      if (collectedAmount && collectedAmount > 0) {
        const existingIncome = await db.select().from(cashTransactions).where(and(eq(cashTransactions.ownerId, ownerId), eq(cashTransactions.sourceVisitId, visitId))).limit(1);
        if (!existingIncome[0]) {
          const category = input.visitType === "installation" ? "تحصيل تركيب" : input.visitType === "maintenance" ? "تحصيل صيانة" : input.visitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
          await db.insert(cashTransactions).values({ ownerId, transactionType: "income", currency: collectedCurrency, amount: collectedAmount, category, transactionDate: input.visitDate, sourceVisitId: visitId, recipientName: storedTechnicianName, notes: storedTechnicianName ? `العميل: ${customer.name} | إيراد أُنشئ تلقائيًا من تسجيل الزيارة بواسطة ${storedTechnicianName}` : `العميل: ${customer.name} | إيراد أُنشئ تلقائيًا من تسجيل الزيارة` });
        }
      }
      await refreshOwnerBackup(ownerId);
      return { id: visitId, reminderCreated: shouldCreateFollowUp, alreadySynced: false };
    }),
    updateDetails: adminProcedure.input(z.object({
      id: z.number().int().positive(),
      visitType: z.enum(visitTypes),
      visitDate: z.date(),
      nextVisitDate: z.date().optional().nullable(),
      technicianName: z.string().trim().max(160).optional().nullable(),
      salesAgentName: z.string().trim().max(160).optional().nullable(),
      filterCount: z.number().int().positive().max(1000).optional().default(1),
      tdsIn: z.number().int().nonnegative().max(100000).optional().nullable(),
      tdsOut: z.number().int().nonnegative().max(100000).optional().nullable(),
      visitResult: z.string().trim().max(2000).optional().nullable(),
      notes: z.string().trim().max(2000).optional().nullable(),
      status: z.enum(["assigned", "en_route", "arrived", "in_progress", "completed", "postponed", "cancelled"]).optional(),
      collectedAmount: z.number().int().nonnegative(),
      collectedCurrency: z.enum(cashCurrencies).optional().default("SAR"),
      pin: sensitivePinInput.shape.pin,
    })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const existing = await db.select().from(visits).where(and(eq(visits.id, input.id), eq(visits.ownerId, ctx.user.id))).limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الزيارة غير موجودة" });
      const nextStatus = input.status ?? existing[0].status;
      await db.update(visits).set({
        visitType: input.visitType,
        visitDate: input.visitDate,
        nextVisitDate: input.nextVisitDate ?? null,
        technicianName: input.technicianName ?? null,
        salesAgentName: input.salesAgentName ?? null,
        filterCount: input.filterCount,
        tdsIn: input.tdsIn ?? null,
        tdsOut: input.tdsOut ?? null,
        visitResult: input.visitResult ?? null,
        notes: input.notes ?? null,
        status: nextStatus,
        completedAt: nextStatus === "completed" ? (existing[0].completedAt ?? new Date()) : existing[0].completedAt,
      }).where(and(eq(visits.id, input.id), eq(visits.ownerId, ctx.user.id)));

      await db.update(reminders).set({ status: "completed" }).where(and(eq(reminders.ownerId, ctx.user.id), eq(reminders.customerId, existing[0].customerId), eq(reminders.status, "pending")));
      if (needsAutomaticReminder(input.visitType)) {
        const pending = await db.select().from(reminders).where(and(eq(reminders.visitId, input.id), eq(reminders.ownerId, ctx.user.id), eq(reminders.status, "pending"))).limit(1);
        if (pending[0]) await db.update(reminders).set({ reminderDate: input.nextVisitDate ?? followUpDate(input.visitDate) }).where(eq(reminders.id, pending[0].id));
        else await db.insert(reminders).values({ customerId: existing[0].customerId, visitId: input.id, ownerId: ctx.user.id, reminderDate: input.nextVisitDate ?? followUpDate(input.visitDate) });
      }

      const income = await db.select().from(cashTransactions).where(and(eq(cashTransactions.ownerId, ctx.user.id), eq(cashTransactions.sourceVisitId, input.id))).limit(1);
      const category = input.visitType === "installation" ? "تحصيل تركيب" : input.visitType === "maintenance" ? "تحصيل صيانة" : input.visitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
      if (input.collectedAmount > 0) {
        if (income[0]) await db.update(cashTransactions).set({ amount: input.collectedAmount, currency: input.collectedCurrency, category, transactionDate: input.visitDate, recipientName: input.technicianName ?? null }).where(and(eq(cashTransactions.id, income[0].id), eq(cashTransactions.ownerId, ctx.user.id)));
        else await db.insert(cashTransactions).values({ ownerId: ctx.user.id, transactionType: "income", currency: input.collectedCurrency, amount: input.collectedAmount, category, transactionDate: input.visitDate, sourceVisitId: input.id, recipientName: input.technicianName ?? null, notes: "إيراد مصحح من تسجيل زيارة" });
      } else if (income[0]) {
        await db.delete(cashTransactions).where(and(eq(cashTransactions.id, income[0].id), eq(cashTransactions.ownerId, ctx.user.id)));
      }
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    updateDate: protectedProcedure.input(z.object({ visitId: z.number().int().positive(), visitDate: z.date(), pin: sensitivePinInput.shape.pin })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const existing = await db.select().from(visits).where(and(eq(visits.id, input.visitId), eq(visits.ownerId, ctx.user.id))).limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الزيارة غير موجودة" });
      await db.update(visits).set({ visitDate: input.visitDate }).where(and(eq(visits.id, input.visitId), eq(visits.ownerId, ctx.user.id)));
      if (needsAutomaticReminder(existing[0].visitType)) {
        const pending = await db.select().from(reminders).where(and(eq(reminders.visitId, input.visitId), eq(reminders.ownerId, ctx.user.id), eq(reminders.status, "pending"))).limit(1);
        if (pending[0]) {
          await db.update(reminders).set({ reminderDate: existing[0].nextVisitDate ?? followUpDate(input.visitDate) }).where(eq(reminders.id, pending[0].id));
        }
      }
      await db.update(cashTransactions).set({ transactionDate: input.visitDate }).where(and(eq(cashTransactions.sourceVisitId, input.visitId), eq(cashTransactions.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    delete: protectedProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await db.delete(visits).where(and(eq(visits.id, input.id), eq(visits.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),

  reminders: router({
    due: protectedProcedure.query(({ ctx }) => remindersWithCustomers(ctx.user.id, true)),
    alerts: protectedProcedure.query(async ({ ctx }) => {
      const settings = await getNotificationSettings(ctx.user.id);
      const pending = await remindersWithCustomers(ctx.user.id, false);
      return pending
        .filter(reminder => isReminderAlertActive(reminder.reminderDate, settings))
        .map(reminder => ({ ...reminder, alertDate: alertDateForReminder(reminder.reminderDate, settings) }));
    }),
    updateStatus: protectedProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["completed", "dismissed"]), pin: sensitivePinInput.shape.pin })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const reminder = await db.select().from(reminders).where(and(eq(reminders.id, input.id), eq(reminders.ownerId, ctx.user.id))).limit(1);
      if (!reminder[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على التذكير." });
      }

      if (input.status === "completed") {
        const sourceVisit = await db.select().from(visits).where(and(
          eq(visits.id, reminder[0].visitId),
          eq(visits.ownerId, ctx.user.id),
        )).limit(1);
        if (sourceVisit[0] && needsAutomaticReminder(sourceVisit[0].visitType)) {
          const completedAt = new Date();
          const visitResult = await db.insert(visits).values({
            customerId: reminder[0].customerId,
            ownerId: ctx.user.id,
            visitType: sourceVisit[0].visitType,
            visitDate: completedAt,
            technicianName: sourceVisit[0].technicianName ?? null,
            notes: "تم تسجيل الزيارة من قائمة المتابعة.",
          });
          const visitId = Number(visitResult[0].insertId);
          await db.insert(reminders).values({
            customerId: reminder[0].customerId,
            visitId,
            ownerId: ctx.user.id,
            reminderDate: followUpDate(completedAt),
          });
        }
      }

      await db.update(reminders).set({ status: input.status }).where(and(eq(reminders.id, input.id), eq(reminders.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true, nextVisitCreated: input.status === "completed" };
    }),
    delete: protectedProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await db.delete(reminders).where(and(eq(reminders.id, input.id), eq(reminders.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),

  notifications: router({
    settings: protectedProcedure.query(({ ctx }) => getNotificationSettings(ctx.user.id)),
    nextAlert: protectedProcedure.query(async ({ ctx }) => {
      const settings = await getNotificationSettings(ctx.user.id);
      const pending = await remindersWithCustomers(ctx.user.id, false);
      const upcoming = pending
        .filter(reminder => !reminder.alertedAt)
        .map(reminder => ({ ...reminder, alertDate: alertDateForReminder(reminder.reminderDate, settings) }))
        .sort((first, second) => first.alertDate.getTime() - second.alertDate.getTime());
      return upcoming[0] ?? null;
    }),
    saveSettings: protectedProcedure.input(notificationSettingsSaveInput).mutation(async ({ ctx, input }) => {
      await requirePinIfConfigured(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const { pin: _pin, ...settingsInput } = input;
      await db.insert(notificationSettings).values({ ownerId: ctx.user.id, ...settingsInput }).onDuplicateKeyUpdate({ set: settingsInput });
      await refreshOwnerBackup(ctx.user.id);
      return getNotificationSettings(ctx.user.id);
    }),
    setPin: protectedProcedure.input(pinSetupInput).mutation(async ({ ctx, input }) => {
      const settings = await getNotificationSettingsRow(ctx.user.id);
      if (settings.pinHash) {
        if (!input.currentPin) throw new TRPCError({ code: "FORBIDDEN", message: "أدخل الرقم السري الحالي لتغييره." });
        await requirePin(ctx.user.id, input.currentPin);
      }
      const db = await databaseOrThrow();
      const pinHash = await hashPin(input.newPin);
      await db.insert(notificationSettings).values({ ownerId: ctx.user.id, ...defaultNotificationSettings, pinHash }).onDuplicateKeyUpdate({ set: { pinHash } });
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    verifyPin: protectedProcedure.input(sensitivePinInput).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      return { success: true };
    }),
    enableScheduledAlerts: protectedProcedure.input(notificationSettingsSaveInput).mutation(async ({ ctx, input }) => {
      await requirePinIfConfigured(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      const { pin: _pin, ...settingsInput } = input;
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      if (!sessionToken) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "سجّل الدخول لتفعيل التنبيهات التلقائية." });
      }
      await db.insert(notificationSettings).values({ ownerId: ctx.user.id, ...settingsInput }).onDuplicateKeyUpdate({ set: settingsInput });
      const settings = await getNotificationSettings(ctx.user.id);
      const cron = "0 */5 * * * *";
      if (settings.scheduleCronTaskUid) {
        const result = await updateHeartbeatJob(settings.scheduleCronTaskUid, { cron, enable: true, description: "فحص تنبيهات مواعيد فلاتر المياه كل خمس دقائق" }, sessionToken);
        return { active: true, nextExecutionAt: result.nextExecutionAt ?? null };
      }
      const job = await createHeartbeatJob({
        name: `water-filter-reminders-${ctx.user.id}`,
        cron,
        path: "/api/scheduled/reminder-alerts",
        description: "إرسال تنبيه قبل مواعيد متابعة فلاتر المياه",
      }, sessionToken);
      await db.update(notificationSettings).set({ scheduleCronTaskUid: job.taskUid }).where(eq(notificationSettings.ownerId, ctx.user.id));
      return { active: true, nextExecutionAt: job.nextExecutionAt ?? null };
    }),
  }),

  inventory: router({
    summary: adminProcedure.query(({ ctx }) => inventorySummary(ctx.user.id)),
    technicianSummary: protectedProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const assigned = await db.select({ ownerId: visits.ownerId }).from(visits).where(eq(visits.assignedTechnicianId, ctx.user.id));
      const ownerIds = Array.from(new Set(assigned.map(row => row.ownerId)));
      if (!ownerIds.length) return { items: [] as Array<{ id: number; name: string; unit: string; reorderLevel: number; currentBalance: number }> };
      const summaries = await Promise.all(ownerIds.map(ownerId => inventorySummary(ownerId)));
      return { items: summaries.flatMap(summary => summary.items).map(item => ({ id: item.id, name: item.name, unit: item.unit, reorderLevel: item.reorderLevel, currentBalance: item.currentBalance })) };
    }),
    createItem: adminProcedure.input(inventoryItemInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      if (input.clientOperationId) {
        const existingOperation = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.ownerId, ctx.user.id), eq(inventoryItems.clientOperationId, input.clientOperationId))).limit(1);
        if (existingOperation[0]) return { id: existingOperation[0].id, merged: false, duplicate: false };
        const existingMovement = await db.select({ id: inventoryMovements.id, inventoryItemId: inventoryMovements.inventoryItemId }).from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ctx.user.id), eq(inventoryMovements.clientOperationId, input.clientOperationId))).limit(1);
        if (existingMovement[0]) return { id: existingMovement[0].inventoryItemId, movementId: existingMovement[0].id, merged: true, duplicate: true };
      }

      const normalizedName = input.name.trim();
      const duplicate = await db.select().from(inventoryItems).where(and(eq(inventoryItems.ownerId, ctx.user.id), eq(inventoryItems.name, normalizedName))).limit(1);
      if (duplicate[0]) {
        if (input.openingQuantity <= 0) {
          await refreshOwnerBackup(ctx.user.id);
          return { id: duplicate[0].id, merged: true, duplicate: true, movementId: null };
        }
        const movementDate = new Date();
        const movementResult = await db.insert(inventoryMovements).values({
          ownerId: ctx.user.id,
          inventoryItemId: duplicate[0].id,
          movementType: "incoming",
          quantity: input.openingQuantity,
          unitCost: input.defaultUnitCost,
          currency: "SAR",
          movementDate,
          notes: input.notes || `إضافة وارد للصنف الموجود: ${normalizedName}`,
          clientOperationId: input.clientOperationId,
        });
        const movementId = Number(movementResult[0].insertId);
        if (shouldCreateInventoryPurchase(input.openingQuantity, input.defaultUnitCost)) {
          await db.insert(cashTransactions).values({
            ownerId: ctx.user.id,
            transactionType: "expense",
            currency: "SAR",
            amount: calculateInventoryPurchaseAmount(input.openingQuantity, input.defaultUnitCost),
            category: `شراء مخزون - ${duplicate[0].name}`,
            transactionDate: movementDate,
            sourceInventoryMovementId: movementId,
            recipientName: "مشتريات",
            notes: input.notes || `شراء ${input.openingQuantity} من ${duplicate[0].name}`,
          });
        }
        await refreshOwnerBackup(ctx.user.id);
        return { id: duplicate[0].id, movementId, merged: true, duplicate: true };
      }

      // الصنف الجديد يبدأ برصيد افتتاحي صفري، وتُسجل الكمية المدخلة كحركة وارد
      // حتى يكون لها تاريخ واضح وتُربط بتكلفة شراء واحدة في الخزينة.
      const { openingQuantity, defaultUnitCost, clientOperationId, ...itemData } = input;
      const result = await db.insert(inventoryItems).values({ ...itemData, name: normalizedName, openingQuantity: 0, defaultUnitCost, clientOperationId, ownerId: ctx.user.id });
      const itemId = Number(result[0].insertId);
      let movementId: number | null = null;
      if (openingQuantity > 0) {
        const movementDate = new Date();
        const movementResult = await db.insert(inventoryMovements).values({
          ownerId: ctx.user.id,
          inventoryItemId: itemId,
          movementType: "incoming",
          quantity: openingQuantity,
          unitCost: defaultUnitCost,
          currency: "SAR",
          movementDate,
          notes: input.notes || `الرصيد الافتتاحي للصنف: ${normalizedName}`,
          clientOperationId,
        });
        movementId = Number(movementResult[0].insertId);
        if (shouldCreateInventoryPurchase(openingQuantity, defaultUnitCost)) {
          await db.insert(cashTransactions).values({
            ownerId: ctx.user.id,
            transactionType: "expense",
            currency: "SAR",
            amount: calculateInventoryPurchaseAmount(openingQuantity, defaultUnitCost),
            category: `شراء مخزون - ${normalizedName}`,
            transactionDate: movementDate,
            sourceInventoryMovementId: movementId,
            recipientName: "مشتريات",
            notes: input.notes || `شراء ${openingQuantity} من ${normalizedName}`,
          });
        }
      }
      await refreshOwnerBackup(ctx.user.id);
      return { id: itemId, movementId, merged: false, duplicate: false };
    }),
    updateAppearance: adminProcedure.input(inventoryAppearanceInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const item = await db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).where(and(eq(inventoryItems.id, input.inventoryItemId), eq(inventoryItems.ownerId, ctx.user.id))).limit(1);
      if (!item[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود." });

      let imageKey: string | null | undefined;
      let imageUrl: string | null | undefined;
      if (input.clearImage) {
        imageKey = null;
        imageUrl = null;
      } else if (input.imageDataUrl) {
        const match = input.imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر صورة بصيغة PNG أو JPG أو WEBP أو GIF." });
        const contentType = match[1];
        const buffer = Buffer.from(match[2], "base64");
        if (buffer.length > 1_000_000) throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة بعد الضغط يجب ألا يتجاوز 1 ميجابايت." });
        const extension = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
        const uploaded = await storagePut(`water-filter-items/${ctx.user.id}/${input.inventoryItemId}.${extension}`, buffer, contentType);
        imageKey = uploaded.key;
        imageUrl = uploaded.url;
      }

      await db.update(inventoryItems).set({ customEmoji: input.customEmoji?.trim() || null, ...(imageKey !== undefined ? { imageKey } : {}), ...(imageUrl !== undefined ? { imageUrl } : {}) }).where(and(eq(inventoryItems.id, input.inventoryItemId), eq(inventoryItems.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    createMovement: adminProcedure.input(inventoryMovementInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      if (input.clientOperationId) {
        const existing = await db.select({ id: inventoryMovements.id }).from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ctx.user.id), eq(inventoryMovements.clientOperationId, input.clientOperationId))).limit(1);
        if (existing[0]) return { success: true, movementId: existing[0].id };
      }
      const item = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, input.inventoryItemId), eq(inventoryItems.ownerId, ctx.user.id))).limit(1);
      if (!item[0]) throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الصنف." });
      const itemMovements = await db
        .select()
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.inventoryItemId, input.inventoryItemId), eq(inventoryMovements.ownerId, ctx.user.id)));
      const currentBalance = calculateStockBalance(item[0].openingQuantity, itemMovements);
      if (input.movementType === "outgoing" && input.quantity > currentBalance) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن صرف ${input.quantity}؛ الرصيد المتاح هو ${currentBalance}.` });
      }
      const movementResult = await db.insert(inventoryMovements).values({ ...input, ownerId: ctx.user.id });
      const movementId = Number(movementResult[0].insertId);
      if (input.movementType === "incoming" && shouldCreateInventoryPurchase(input.quantity, input.unitCost)) {
        const purchaseAmount = calculateInventoryPurchaseAmount(input.quantity, input.unitCost);
        const existingPurchase = await db.select({ id: cashTransactions.id }).from(cashTransactions).where(and(eq(cashTransactions.ownerId, ctx.user.id), eq(cashTransactions.sourceInventoryMovementId, movementId))).limit(1);
        if (!existingPurchase[0]) {
          await db.insert(cashTransactions).values({
            ownerId: ctx.user.id,
            transactionType: "expense",
            currency: input.currency,
            amount: purchaseAmount,
            category: `شراء مخزون - ${item[0].name}`,
            transactionDate: input.movementDate,
            sourceInventoryMovementId: movementId,
            recipientName: "مشتريات",
            notes: input.notes || `شراء ${input.quantity} من ${item[0].name}`,
          });
        }
      }
      await refreshOwnerBackup(ctx.user.id);
      return { success: true, movementId };
    }),
    deleteItem: adminProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await db.delete(inventoryItems).where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
    deleteMovement: adminProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await db.delete(cashTransactions).where(and(eq(cashTransactions.sourceInventoryMovementId, input.id), eq(cashTransactions.ownerId, ctx.user.id)));
      await db.delete(inventoryMovements).where(and(eq(inventoryMovements.id, input.id), eq(inventoryMovements.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),

  technicians: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const ownerId = await getCompanyOwnerId(ctx.user.id, ctx.user.role);
      const accounts = await db.select({ linkedUserId: allowedTechnicianAccounts.linkedUserId, email: allowedTechnicianAccounts.email, displayName: allowedTechnicianAccounts.displayName }).from(allowedTechnicianAccounts).where(and(eq(allowedTechnicianAccounts.ownerId, ownerId), eq(allowedTechnicianAccounts.isActive, true)));
      const technicians: Array<{ id: number; name: string | null; role: "admin" | "user" }> = [];
      for (const account of accounts) {
        const match = account.linkedUserId
          ? (await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.id, account.linkedUserId), eq(users.role, "user"))).limit(1))[0]
          : (await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.email, account.email), eq(users.role, "user"))).limit(1))[0];
        if (match) technicians.push({ id: match.id, name: match.name || account.displayName, role: match.role });
      }
      return technicians;
    }),
    updateLocation: protectedProcedure.input(z.object({ latitude: z.string().regex(/^-?\d{1,3}(?:\.\d+)?$/), longitude: z.string().regex(/^-?\d{1,3}(?:\.\d+)?$/), accuracy: z.number().int().nonnegative().max(100000).optional(), sharingUntil: z.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role === "admin") throw new TRPCError({ code: "FORBIDDEN", message: "تحديث الموقع مخصص لحساب الفني." });
      const db = await databaseOrThrow();
      const assigned = await db.select({ ownerId: visits.ownerId }).from(visits).where(and(eq(visits.assignedTechnicianId, ctx.user.id), ne(visits.status, "completed"), ne(visits.status, "cancelled"))).limit(1);
      const ownerId = assigned[0]?.ownerId;
      if (!ownerId) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد أمر عمل نشط يسمح بمشاركة الموقع." });
      const now = new Date();
      await db.insert(technicianLocations).values({ ownerId, technicianId: ctx.user.id, latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? null, recordedAt: now, sharingUntil: input.sharingUntil ?? null }).onDuplicateKeyUpdate({ set: { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? null, recordedAt: now, sharingUntil: input.sharingUntil ?? null } });
      return { success: true, recordedAt: now };
    }),
    latestLocations: adminProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const [locations, techs] = await Promise.all([
        db.select().from(technicianLocations).where(eq(technicianLocations.ownerId, ctx.user.id)),
        db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "user")),
      ]);
      const byTech = new Map(locations.map(location => [location.technicianId, location]));
      return techs.map(tech => ({ technician: tech, location: byTech.get(tech.id) ?? null }));
    }),
  }),

  workOrders: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await databaseOrThrow();
      const condition = ctx.user.role === "admin"
        ? and(eq(visits.ownerId, ctx.user.id), isNotNull(visits.assignedTechnicianId))
        : eq(visits.assignedTechnicianId, ctx.user.id);
      const rows = await db.select().from(visits).where(condition).orderBy(asc(visits.visitDate));
      const ownerIds = Array.from(new Set(rows.map(row => row.ownerId)));
      if (!ownerIds.length) return [];
      const [customerRows, incomeRows, proofRows] = await Promise.all([
        db.select().from(customers).where(inArray(customers.ownerId, ownerIds)),
        db.select().from(cashTransactions).where(and(inArray(cashTransactions.ownerId, ownerIds), eq(cashTransactions.transactionType, "income"))),
        db.select({ id: workOrderProofs.id, visitId: workOrderProofs.visitId, kind: workOrderProofs.kind, photoSlot: workOrderProofs.photoSlot, url: workOrderProofs.url, mimeType: workOrderProofs.mimeType, createdAt: workOrderProofs.createdAt }).from(workOrderProofs).where(and(inArray(workOrderProofs.visitId, rows.map(row => row.id)), inArray(workOrderProofs.ownerId, ownerIds))).orderBy(desc(workOrderProofs.createdAt)),
      ]);
      const customerById = new Map(customerRows.map(customer => [customer.id, customer]));
      const incomeByVisit = new Map(incomeRows.filter(row => row.sourceVisitId).map(row => [row.sourceVisitId!, row]));
      const proofsByVisit = new Map<number, typeof proofRows>();
      for (const proof of proofRows) {
        const existing = proofsByVisit.get(proof.visitId) ?? [];
        existing.push(proof);
        proofsByVisit.set(proof.visitId, existing);
      }
      return rows.map(row => ({
        ...row,
        customer: customerById.get(row.customerId) ? {
          id: customerById.get(row.customerId)!.id,
          name: customerById.get(row.customerId)!.name,
          phone: customerById.get(row.customerId)!.phone,
          address: customerById.get(row.customerId)!.address,
          latitude: customerById.get(row.customerId)!.latitude,
          longitude: customerById.get(row.customerId)!.longitude,
          manualCode: customerById.get(row.customerId)!.manualCode,
        } : null,
        collectedAmount: incomeByVisit.get(row.id)?.amount ?? 0,
        proofs: proofsByVisit.get(row.id) ?? [],
      }));
    }),
    create: adminProcedure.input(workOrderCreateInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const customer = await getOwnedCustomer(ctx.user.id, input.customerId);
      const technician = await db.select({ id: users.id, name: users.name }).from(users).innerJoin(allowedTechnicianAccounts, eq(allowedTechnicianAccounts.linkedUserId, users.id)).where(and(eq(users.id, input.assignedTechnicianId), eq(allowedTechnicianAccounts.ownerId, ctx.user.id), eq(allowedTechnicianAccounts.isActive, true))).limit(1);
      if (!technician[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الفني غير موجود أو غير مرتبط بحساب الشركة." });
      if (input.clientOperationId) {
        const existing = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.ownerId, ctx.user.id), eq(visits.clientOperationId, input.clientOperationId))).limit(1);
        if (existing[0]) return { id: existing[0].id, alreadySynced: true };
      }
      const inserted = await db.insert(visits).values({ customerId: customer.id, ownerId: ctx.user.id, visitType: input.visitType, visitDate: input.visitDate, technicianName: technician[0].name, assignedTechnicianId: technician[0].id, status: "assigned", notes: input.notes ?? null, clientOperationId: input.clientOperationId });
      await refreshOwnerBackup(ctx.user.id);
      return { id: Number(inserted[0].insertId), alreadySynced: false };
    }),
    addProof: protectedProcedure.input(workOrderProofInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const condition = ctx.user.role === "admin"
        ? and(eq(visits.id, input.visitId), eq(visits.ownerId, ctx.user.id))
        : and(eq(visits.id, input.visitId), eq(visits.assignedTechnicianId, ctx.user.id));
      const visit = (await db.select({ id: visits.id, ownerId: visits.ownerId }).from(visits).where(condition).limit(1))[0];
      if (!visit) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود أو غير مسند إليك." });
      const match = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match || !isSupportedEvidenceMime(match[1], input.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "صيغة الدليل غير صالحة. اختر صورة أو تسجيلًا مدعومًا." });
      const mimeType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      const maxBytes = input.kind === "audio" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
      if (buffer.byteLength > maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: input.kind === "audio" ? "حجم التسجيل الصوتي أكبر من 10 ميجابايت." : "حجم الدليل أكبر من 5 ميجابايت." });
      const extension = mimeType.split("/")[1];
      const key = `water-filter-proofs/${visit.ownerId}/${visit.id}/${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
      const uploaded = await storagePut(key, buffer, mimeType);
      const inserted = await db.insert(workOrderProofs).values({ ownerId: visit.ownerId, visitId: visit.id, uploadedBy: ctx.user.id, kind: input.kind, photoSlot: input.kind === "photo" ? (input.photoSlot ?? "general") : null, storageKey: uploaded.key, url: uploaded.url, mimeType });
      if (input.kind === "photo" && input.photoSlot && input.photoSlot !== "general") {
        await db.update(visits).set(input.photoSlot === "before" ? { photoBeforeKey: uploaded.key } : { photoAfterKey: uploaded.key }).where(eq(visits.id, visit.id));
      }
      return { id: Number(inserted[0].insertId), url: uploaded.url, kind: input.kind };
    }),
    listProofs: protectedProcedure.input(z.object({ visitId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const condition = ctx.user.role === "admin"
        ? and(eq(visits.id, input.visitId), eq(visits.ownerId, ctx.user.id))
        : and(eq(visits.id, input.visitId), eq(visits.assignedTechnicianId, ctx.user.id));
      const visit = (await db.select({ id: visits.id, ownerId: visits.ownerId }).from(visits).where(condition).limit(1))[0];
      if (!visit) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود." });
      return db.select({ id: workOrderProofs.id, kind: workOrderProofs.kind, photoSlot: workOrderProofs.photoSlot, url: workOrderProofs.url, mimeType: workOrderProofs.mimeType, createdAt: workOrderProofs.createdAt }).from(workOrderProofs).where(and(eq(workOrderProofs.visitId, visit.id), eq(workOrderProofs.ownerId, visit.ownerId))).orderBy(desc(workOrderProofs.createdAt));
    }),
    updateStatus: protectedProcedure.input(workOrderUpdateInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      const condition = ctx.user.role === "admin"
        ? and(eq(visits.id, input.id), eq(visits.ownerId, ctx.user.id))
        : and(eq(visits.id, input.id), eq(visits.assignedTechnicianId, ctx.user.id));
      const rows = await db.select().from(visits).where(condition).limit(1);
      const visit = rows[0];
      if (!visit) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود." });
      const allowed = ctx.user.role === "admin" || visit.assignedTechnicianId === ctx.user.id;
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تعديل أمر العمل هذا." });
      const ownerId = visit.ownerId;
      const now = new Date();
      const hasNextVisitOverride = input.nextVisitDate !== undefined || input.followUpDays !== undefined;
      const scheduledNextVisitDate = input.nextVisitDate ?? (input.followUpDays == null ? null : followUpDate(now, input.followUpDays));
      const nextVisitDate = hasNextVisitOverride ? scheduledNextVisitDate : visit.nextVisitDate;
      const outcome = input.executionOutcome ?? (input.status === "completed" ? "completed" : input.status === "postponed" || input.status === "cancelled" ? "not_completed" : visit.executionOutcome);
      if (outcome === "not_completed" && !input.notCompletedReason?.trim() && !visit.notCompletedReason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "اكتب سبب عدم تنفيذ الزيارة قبل الحفظ." });
      }
      await db.update(visits).set({ status: input.status, nextVisitDate, visitResult: input.visitResult ?? visit.visitResult, notes: input.notes ?? visit.notes, executionOutcome: outcome, notCompletedReason: outcome === "not_completed" ? input.notCompletedReason?.trim() ?? visit.notCompletedReason : null, arrivedAt: input.status === "arrived" ? now : visit.arrivedAt, completedAt: input.status === "completed" ? now : visit.completedAt, tdsIn: input.tdsIn ?? visit.tdsIn, tdsOut: input.tdsOut ?? visit.tdsOut }).where(and(eq(visits.id, input.id), eq(visits.ownerId, ownerId)));
      if (input.status === "completed" && hasNextVisitOverride) {
        const visitPendingReminder = await db.select().from(reminders).where(and(eq(reminders.ownerId, ownerId), eq(reminders.visitId, visit.id), eq(reminders.status, "pending"))).limit(1);
        await db.update(reminders).set({ status: "completed" }).where(and(eq(reminders.ownerId, ownerId), eq(reminders.customerId, visit.customerId), eq(reminders.status, "pending"), ne(reminders.visitId, visit.id)));
        if (scheduledNextVisitDate) {
          if (visitPendingReminder[0]) await db.update(reminders).set({ reminderDate: scheduledNextVisitDate }).where(and(eq(reminders.id, visitPendingReminder[0].id), eq(reminders.ownerId, ownerId)));
          else await db.insert(reminders).values({ customerId: visit.customerId, visitId: visit.id, ownerId, reminderDate: scheduledNextVisitDate });
        } else if (visitPendingReminder[0]) {
          await db.update(reminders).set({ status: "completed" }).where(and(eq(reminders.id, visitPendingReminder[0].id), eq(reminders.ownerId, ownerId)));
        }
      }
      const lowStockItems: Array<{ id: number; name: string; unit: string; currentBalance: number; reorderLevel: number }> = [];
      if (input.status === "completed" && visit.status !== "completed") {
        const inventoryRows = input.items.length ? await db.select().from(inventoryItems).where(and(eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, input.items.map(item => item.inventoryItemId)))) : [];
        const inventoryById = new Map(inventoryRows.map(item => [item.id, item]));
        for (const requested of input.items) {
          const item = inventoryById.get(requested.inventoryItemId);
          if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "أحد الأصناف غير موجود." });
          const movements = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.inventoryItemId, item.id)));
          const balance = calculateStockBalance(item.openingQuantity, movements);
          if (requested.quantity > balance) throw new TRPCError({ code: "BAD_REQUEST", message: `الرصيد غير كافٍ من صنف ${item.name}؛ المتاح ${balance} والمطلوب ${requested.quantity}.` });
          await db.insert(visitItems).values({ ownerId, visitId: visit.id, inventoryItemId: item.id, itemNameSnapshot: item.name, unitSnapshot: item.unit, quantity: requested.quantity, source: requested.source });
          await db.insert(inventoryMovements).values({ ownerId, inventoryItemId: item.id, customerId: visit.customerId, movementType: "outgoing", quantity: requested.quantity, unitCost: item.defaultUnitCost, currency: "SAR", movementDate: now, technicianName: visit.technicianName, notes: `منصرف لأمر عمل العميل ${visit.customerId}` });
        }
        for (const item of Array.from(inventoryById.values())) {
          const movements = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.inventoryItemId, item.id)));
          const currentBalance = calculateStockBalance(item.openingQuantity, movements);
          const reorderLevel = item.reorderLevel ?? 2;
          if (currentBalance <= reorderLevel) lowStockItems.push({ id: item.id, name: item.name, unit: item.unit, currentBalance, reorderLevel });
        }
        if (input.collectedAmount > 0) {
          const category = visit.visitType === "installation" ? "تحصيل تركيب" : visit.visitType === "maintenance" ? "تحصيل صيانة" : visit.visitType === "cartridge_change" ? "تحصيل تغيير شمعات" : "تحصيل زيارة";
          await db.insert(cashTransactions).values({ ownerId, transactionType: "income", currency: input.collectedCurrency, amount: input.collectedAmount, category, transactionDate: now, sourceVisitId: visit.id, recipientName: visit.technicianName, notes: `تحصيل من أمر عمل العميل ${visit.customerId}` });
        }
      }
      await refreshOwnerBackup(ownerId);
      return { success: true, lowStockItems };
    }),
  }),

  backup: router({
    options: protectedProcedure.query(() => ({ tables: BACKUP_TABLES })),
    status: protectedProcedure.query(async ({ ctx }) => getOwnerBackupStatus(ctx.user.id)),
    createNow: protectedProcedure.input(z.object({ tables: z.array(z.string()).optional() }).optional()).mutation(async ({ ctx, input }) => {
      const allowed = new Set(BACKUP_TABLES.map(table => table.key));
      const selected = (input?.tables ?? []).filter((table): table is typeof BACKUP_TABLES[number]["key"] => allowed.has(table as typeof BACKUP_TABLES[number]["key"]));
      const backup = await createOwnerBackup(ctx.user.id, { tables: selected.length ? selected : undefined, exportedBy: ctx.user.id });
      if (!backup) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء النسخة الاحتياطية الآن." });
      return { generatedAt: backup.generatedAt, downloadUrl: backup.url, counts: backup.counts, tables: backup.tables };
    }),
  }),

  dailyCashClosing: adminProcedure.input(z.object({ date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional() }).optional()).query(async ({ ctx, input }) => {
    const db = await databaseOrThrow();
    const date = input?.date ?? new Date().toISOString().slice(0, 10);
    const from = new Date(`${date}T00:00:00.000`);
    const to = new Date(`${date}T23:59:59.999`);
    const [rows, income] = await Promise.all([
      db.select({ technicianName: visits.technicianName, status: visits.status, executionOutcome: visits.executionOutcome }).from(visits).where(and(eq(visits.ownerId, ctx.user.id), gte(visits.visitDate, from), lte(visits.visitDate, to))),
      db.select({ technicianName: cashTransactions.recipientName, amount: cashTransactions.amount }).from(cashTransactions).where(and(eq(cashTransactions.ownerId, ctx.user.id), eq(cashTransactions.transactionType, "income"), gte(cashTransactions.transactionDate, from), lte(cashTransactions.transactionDate, to))),
    ]);
    const byName = new Map<string, { technicianName: string; visitsCompleted: number; collectedAmount: number }>();
    for (const row of rows) {
      if (row.status !== "completed" || row.executionOutcome === "not_completed") continue;
      const technicianName = row.technicianName?.trim() || "غير محدد";
      const current = byName.get(technicianName) ?? { technicianName, visitsCompleted: 0, collectedAmount: 0 };
      current.visitsCompleted += 1;
      byName.set(technicianName, current);
    }
    for (const row of income) {
      const technicianName = row.technicianName?.trim() || "غير محدد";
      const current = byName.get(technicianName) ?? { technicianName, visitsCompleted: 0, collectedAmount: 0 };
      current.collectedAmount += Number(row.amount || 0);
      byName.set(technicianName, current);
    }
    const technicians = Array.from(byName.values()).sort((a, b) => b.collectedAmount - a.collectedAmount || a.technicianName.localeCompare(b.technicianName, "ar-EG"));
    return { date, technicians, totalVisits: technicians.reduce((sum, row) => sum + row.visitsCompleted, 0), totalCollected: technicians.reduce((sum, row) => sum + row.collectedAmount, 0) };
  }),

  cash: router({
    summary: adminProcedure.input(z.object({ incomeFilter: z.enum(["all", "service", "installation", "maintenance"]).default("all"), category: z.string().max(100).optional(), technician: z.string().max(160).optional(), partyType: z.enum(["all", "technician", "customer", "entity"]).default("all").optional(), itemName: z.string().max(160).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), search: z.string().max(160).optional() }).optional()).query(({ ctx, input }) => cashSummary(ctx.user.id, input?.incomeFilter ?? "all", input ? { month: input.month, startDate: input.startDate, endDate: input.endDate } : undefined, input?.search, { category: input?.category, technician: input?.technician, partyType: input?.partyType, itemName: input?.itemName })),
    create: adminProcedure.input(cashTransactionInput).mutation(async ({ ctx, input }) => {
      const db = await databaseOrThrow();
      if (input.clientOperationId) {
        const existing = await db.select({ id: cashTransactions.id }).from(cashTransactions).where(and(eq(cashTransactions.ownerId, ctx.user.id), eq(cashTransactions.clientOperationId, input.clientOperationId))).limit(1);
        if (existing[0]) return { id: existing[0].id };
      }
      const result = await db.insert(cashTransactions).values({ ...input, ownerId: ctx.user.id });
      await refreshOwnerBackup(ctx.user.id);
      return { id: Number(result[0].insertId) };
    }),
    delete: adminProcedure.input(sensitivePinInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await requirePin(ctx.user.id, input.pin);
      const db = await databaseOrThrow();
      await db.delete(cashTransactions).where(and(eq(cashTransactions.id, input.id), eq(cashTransactions.ownerId, ctx.user.id)));
      await refreshOwnerBackup(ctx.user.id);
      return { success: true };
    }),
  }),
});
