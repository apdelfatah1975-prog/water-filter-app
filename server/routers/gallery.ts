import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  galleryCashTransactions,
  galleryInstallments,
  galleryProducts,
  gallerySaleItems,
  gallerySales,
  gallerySettings,
} from "../../drizzle/schema";

const money = z.number().int().nonnegative();
const dateInput = z.coerce.date();
export function calculateGalleryTotals(items: Array<{ quantity: number; unitPrice: number }>) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
export function resolveGalleryCashbox(mergeWithMainCash: boolean) {
  return mergeWithMainCash ? "main" : "gallery";
}
const productInput = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(1).max(120).default("عام"),
  unit: z.string().trim().min(1).max(40).default("قطعة"),
  sellingPrice: money,
  purchasePrice: money.default(0),
  stockQuantity: z.number().int().nonnegative().default(0),
  reorderLevel: z.number().int().nonnegative().default(2),
  notes: z.string().trim().max(2000).optional(),
});

function dayWindow(date = new Date()) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export const galleryRouter = router({
  settings: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      const row = await db.select().from(gallerySettings).where(eq(gallerySettings.ownerId, ctx.user.id)).limit(1);
      return row[0] ?? { id: 0, ownerId: ctx.user.id, mergeWithMainCash: false };
    }),
    update: adminProcedure.input(z.object({ mergeWithMainCash: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      const existing = await db.select({ id: gallerySettings.id }).from(gallerySettings).where(eq(gallerySettings.ownerId, ctx.user.id)).limit(1);
      if (existing[0]) await db.update(gallerySettings).set({ mergeWithMainCash: input.mergeWithMainCash }).where(eq(gallerySettings.id, existing[0].id));
      else await db.insert(gallerySettings).values({ ownerId: ctx.user.id, mergeWithMainCash: input.mergeWithMainCash });
      return { success: true, mergeWithMainCash: input.mergeWithMainCash };
    }),
  }),
  products: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      return db.select().from(galleryProducts).where(and(eq(galleryProducts.ownerId, ctx.user.id), eq(galleryProducts.isActive, true))).orderBy(galleryProducts.name);
    }),
    create: adminProcedure.input(productInput).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      const result = await db.insert(galleryProducts).values({ ...input, ownerId: ctx.user.id });
      const rows = await db.select().from(galleryProducts).where(eq(galleryProducts.id, Number(result[0].insertId))).limit(1);
      return rows[0];
    }),
    adjustStock: adminProcedure.input(z.object({ id: z.number().int().positive(), quantity: z.number().int().positive(), mode: z.enum(["add", "subtract"]) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      return db.transaction(async tx => {
        const rows = await tx.select().from(galleryProducts).where(and(eq(galleryProducts.id, input.id), eq(galleryProducts.ownerId, ctx.user.id))).limit(1);
        const product = rows[0];
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود." });
        const next = product.stockQuantity + (input.mode === "add" ? input.quantity : -input.quantity);
        if (next < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن أن يصبح رصيد المعرض سالبًا." });
        await tx.update(galleryProducts).set({ stockQuantity: next }).where(eq(galleryProducts.id, product.id));
        return { ...product, stockQuantity: next };
      });
    }),
  }),
  dashboard: adminProcedure.input(z.object({ date: dateInput.optional() }).optional()).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
    const { from, to } = dayWindow(input?.date ?? new Date());
    const [products, sales, installments, cashRows, settings] = await Promise.all([
      db.select().from(galleryProducts).where(and(eq(galleryProducts.ownerId, ctx.user.id), eq(galleryProducts.isActive, true))).orderBy(galleryProducts.name),
      db.select().from(gallerySales).where(and(eq(gallerySales.ownerId, ctx.user.id), gte(gallerySales.saleDate, from), lt(gallerySales.saleDate, to))).orderBy(desc(gallerySales.saleDate)),
      db.select().from(galleryInstallments).where(and(eq(galleryInstallments.ownerId, ctx.user.id), eq(galleryInstallments.status, "pending"))).orderBy(galleryInstallments.dueDate),
      db.select().from(galleryCashTransactions).where(and(eq(galleryCashTransactions.ownerId, ctx.user.id), gte(galleryCashTransactions.transactionDate, from), lt(galleryCashTransactions.transactionDate, to))),
      db.select().from(gallerySettings).where(eq(gallerySettings.ownerId, ctx.user.id)).limit(1),
    ]);
    const totalSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const cashSales = sales.filter(sale => sale.paymentMethod === "cash").reduce((sum, sale) => sum + sale.paidAmount, 0);
    const creditSales = sales.filter(sale => sale.paymentMethod === "credit").reduce((sum, sale) => sum + sale.totalAmount, 0);
    const collectedToday = cashRows.reduce((sum, row) => sum + row.amount, 0);
    return { products, sales, installments, settings: settings[0] ?? { mergeWithMainCash: false }, summary: { totalSales, cashSales, creditSales, collectedToday, debtBalance: sales.reduce((sum, sale) => sum + sale.remainingAmount, 0) }, lowStock: products.filter(product => product.stockQuantity <= product.reorderLevel) };
  }),
  sales: router({
    create: adminProcedure.input(z.object({
      customerName: z.string().trim().max(160).optional(),
      customerPhone: z.string().trim().max(32).optional(),
      paymentMethod: z.enum(["cash", "credit"]),
      paidAmount: money,
      saleDate: dateInput.optional(),
      notes: z.string().trim().max(2000).optional(),
      installments: z.array(z.object({ dueDate: dateInput, amount: money })).max(24).optional(),
      items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive(), unitPrice: money.optional() })).min(1),
    }).superRefine((value, ctx) => {
      if (value.paymentMethod === "credit" && !value.customerName) ctx.addIssue({ code: "custom", path: ["customerName"], message: "اسم عميل الآجل مطلوب." });
      if (value.paymentMethod === "cash" && value.installments?.length) ctx.addIssue({ code: "custom", path: ["installments"], message: "لا توجد أقساط للبيع النقدي." });
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      return db.transaction(async tx => {
        const products = [] as Array<{ id: number; name: string; sellingPrice: number; stockQuantity: number }>;
        for (const item of input.items) {
          const row = (await tx.select({ id: galleryProducts.id, name: galleryProducts.name, sellingPrice: galleryProducts.sellingPrice, stockQuantity: galleryProducts.stockQuantity }).from(galleryProducts).where(and(eq(galleryProducts.id, item.productId), eq(galleryProducts.ownerId, ctx.user.id), eq(galleryProducts.isActive, true))).limit(1))[0];
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "أحد أصناف الفاتورة غير موجود." });
          if (row.stockQuantity < item.quantity) throw new TRPCError({ code: "BAD_REQUEST", message: `الرصيد غير كافٍ للصنف: ${row.name}` });
          products.push(row);
        }
        const lines = input.items.map((item, index) => ({ ...item, product: products[index], unitPrice: item.unitPrice ?? products[index].sellingPrice, lineTotal: (item.unitPrice ?? products[index].sellingPrice) * item.quantity }));
        const totalAmount = calculateGalleryTotals(lines);
        if (input.paidAmount > totalAmount) throw new TRPCError({ code: "BAD_REQUEST", message: "الدفعة لا يمكن أن تتجاوز إجمالي الفاتورة." });
        const remainingAmount = totalAmount - input.paidAmount;
        if (input.paymentMethod === "cash" && remainingAmount !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: "البيع النقدي يجب أن يُسدّد بالكامل." });
        if (input.paymentMethod === "credit" && remainingAmount > 0) {
          const planned = (input.installments ?? []).reduce((sum, installment) => sum + installment.amount, 0);
          if (planned !== remainingAmount) throw new TRPCError({ code: "BAD_REQUEST", message: "مجموع الأقساط يجب أن يساوي المبلغ المتبقي." });
        }
        const setting = (await tx.select().from(gallerySettings).where(eq(gallerySettings.ownerId, ctx.user.id)).limit(1))[0];
        const cashMode = resolveGalleryCashbox(Boolean(setting?.mergeWithMainCash));
        const invoiceNumber = `G-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const saleDate = input.saleDate ?? new Date();
        const saleResult = await tx.insert(gallerySales).values({ ownerId: ctx.user.id, invoiceNumber, customerName: input.customerName || null, customerPhone: input.customerPhone || null, paymentMethod: input.paymentMethod, totalAmount, paidAmount: input.paidAmount, remainingAmount, saleDate, cashMode, notes: input.notes || null, createdBy: ctx.user.id });
        const saleId = Number(saleResult[0].insertId);
        for (const line of lines) {
          await tx.insert(gallerySaleItems).values({ ownerId: ctx.user.id, saleId, productId: line.product.id, productNameSnapshot: line.product.name, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal });
          await tx.update(galleryProducts).set({ stockQuantity: line.product.stockQuantity - line.quantity }).where(and(eq(galleryProducts.id, line.product.id), eq(galleryProducts.ownerId, ctx.user.id)));
        }
        if (input.paidAmount > 0) await tx.insert(galleryCashTransactions).values({ ownerId: ctx.user.id, saleId, amount: input.paidAmount, cashbox: cashMode, transactionDate: saleDate, notes: `دفعة فاتورة ${invoiceNumber}` });
        for (const installment of input.installments ?? []) await tx.insert(galleryInstallments).values({ ownerId: ctx.user.id, saleId, dueDate: installment.dueDate, amount: installment.amount, paidAmount: 0, status: "pending" });
        return { saleId, invoiceNumber, totalAmount, paidAmount: input.paidAmount, remainingAmount, cashMode };
      });
    }),
    payInstallment: adminProcedure.input(z.object({ installmentId: z.number().int().positive(), amount: money, paidAt: dateInput.optional() })).mutation(async ({ ctx, input }) => {
      if (input.amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "قيمة الدفعة يجب أن تكون أكبر من صفر." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      return db.transaction(async tx => {
        const row = (await tx.select({ installment: galleryInstallments, sale: gallerySales }).from(galleryInstallments).innerJoin(gallerySales, eq(galleryInstallments.saleId, gallerySales.id)).where(and(eq(galleryInstallments.id, input.installmentId), eq(galleryInstallments.ownerId, ctx.user.id))).limit(1))[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "القسط غير موجود." });
        const remaining = row.installment.amount - row.installment.paidAmount;
        if (input.amount > remaining) throw new TRPCError({ code: "BAD_REQUEST", message: "الدفعة أكبر من المتبقي في القسط." });
        const nextPaid = row.installment.paidAmount + input.amount;
        const status = nextPaid === row.installment.amount ? "paid" : "partial";
        await tx.update(galleryInstallments).set({ paidAmount: nextPaid, status }).where(eq(galleryInstallments.id, input.installmentId));
        await tx.update(gallerySales).set({ paidAmount: row.sale.paidAmount + input.amount, remainingAmount: row.sale.remainingAmount - input.amount }).where(eq(gallerySales.id, row.sale.id));
        await tx.insert(galleryCashTransactions).values({ ownerId: ctx.user.id, saleId: row.sale.id, installmentId: input.installmentId, amount: input.amount, cashbox: row.sale.cashMode, transactionDate: input.paidAt ?? new Date(), notes: `تحصيل قسط من فاتورة ${row.sale.invoiceNumber}` });
        return { success: true, status, remainingAmount: row.sale.remainingAmount - input.amount };
      });
    }),
  }),
});
