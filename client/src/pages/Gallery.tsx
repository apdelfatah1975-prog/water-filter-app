import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { BadgeDollarSign, Banknote, Boxes, CalendarClock, CheckCircle2, Plus, ReceiptText, Settings2, ShoppingCart, Store, Trash2, WalletCards } from "lucide-react";

const money = (value: number) => `${value.toLocaleString("ar-EG")} ج.م`;
const dateValue = (date: Date) => date.toISOString().slice(0, 10);

type CartLine = { productId: number; name: string; quantity: number; unitPrice: number; max: number };
type Installment = { dueDate: string; amount: number };

export default function Gallery() {
  const utils = trpc.useUtils();
  const dashboard = trpc.gallery.dashboard.useQuery(undefined, { refetchOnWindowFocus: false });
  const settingsMutation = trpc.gallery.settings.update.useMutation({ onSuccess: () => { utils.gallery.dashboard.invalidate(); toast.success("تم حفظ طريقة الخزينة"); }, onError: e => toast.error(e.message) });
  const createProduct = trpc.gallery.products.create.useMutation({ onSuccess: () => { utils.gallery.dashboard.invalidate(); setProductForm({ name: "", category: "شمعات", sellingPrice: "", stockQuantity: "", reorderLevel: "2" }); toast.success("تمت إضافة الصنف"); }, onError: e => toast.error(e.message) });
  const createSale = trpc.gallery.sales.create.useMutation({ onSuccess: data => { utils.gallery.dashboard.invalidate(); setCart([]); setCustomerName(""); setCustomerPhone(""); setPaidAmount(""); setInstallments([]); toast.success(`تم حفظ الفاتورة ${data.invoiceNumber}`); }, onError: e => toast.error(e.message) });
  const payInstallment = trpc.gallery.sales.payInstallment.useMutation({ onSuccess: () => { utils.gallery.dashboard.invalidate(); toast.success("تم تسجيل التحصيل"); }, onError: e => toast.error(e.message) });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState({ name: "", category: "شمعات", sellingPrice: "", stockQuantity: "", reorderLevel: "2" });
  const products = dashboard.data?.products ?? [];
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [cart]);
  const paid = paymentMethod === "cash" ? total : Number(paidAmount || 0);
  const remaining = Math.max(0, total - paid);
  const settings = dashboard.data?.settings;

  const addToCart = (product: (typeof products)[number]) => setCart(lines => {
    const existing = lines.find(line => line.productId === product.id);
    if (existing) return lines.map(line => line.productId === product.id ? { ...line, quantity: Math.min(line.quantity + 1, line.max) } : line);
    return [...lines, { productId: product.id, name: product.name, quantity: 1, unitPrice: product.sellingPrice, max: product.stockQuantity }];
  });
  const submitSale = () => {
    if (!cart.length) return toast.error("أضف صنفًا واحدًا على الأقل");
    if (paymentMethod === "credit" && !customerName.trim()) return toast.error("اكتب اسم عميل الآجل");
    if (paymentMethod === "credit" && remaining > 0 && installments.reduce((sum, item) => sum + Number(item.amount || 0), 0) !== remaining) return toast.error("مجموع الأقساط يجب أن يساوي المبلغ المتبقي");
    createSale.mutate({ paymentMethod, paidAmount: paid, customerName: customerName || undefined, customerPhone: customerPhone || undefined, items: cart.map(item => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })), installments: paymentMethod === "credit" ? installments.map(item => ({ dueDate: new Date(`${item.dueDate}T12:00:00`), amount: Number(item.amount) })) : [] });
  };
  const addInstallment = () => setInstallments(rows => [...rows, { dueDate: dateValue(new Date(Date.now() + 30 * 86400000)), amount: remaining }]);

  return <main className="min-w-0 space-y-4 pb-8" dir="rtl">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-teal-800 to-cyan-700 px-4 py-4 text-white shadow-sm">
      <div><p className="text-xs font-bold text-cyan-100">المعرض والبيع المباشر</p><h1 className="mt-1 text-2xl font-black">نقطة بيع المعرض</h1><p className="mt-1 text-sm text-cyan-50">بيع سريع مع فصل مخزون المعرض عن عهدة الفنيين</p></div>
      <div className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-bold"><Store className="h-5 w-5" />{settings?.mergeWithMainCash ? "الخزينة مدمجة" : "خزينة المعرض منفصلة"}</div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Summary icon={<BadgeDollarSign />} title="مبيعات اليوم" value={money(dashboard.data?.summary.totalSales ?? 0)} />
      <Summary icon={<Banknote />} title="كاش اليوم" value={money(dashboard.data?.summary.cashSales ?? 0)} tone="emerald" />
      <Summary icon={<WalletCards />} title="آجل اليوم" value={money(dashboard.data?.summary.creditSales ?? 0)} tone="amber" />
      <Summary icon={<ReceiptText />} title="المحصّل اليوم" value={money(dashboard.data?.summary.collectedToday ?? 0)} tone="sky" />
    </section>

    <section className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_.8fr]">
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-teal-700" /><h2 className="font-black text-slate-900">فاتورة بيع جديدة</h2></div><span className="text-sm font-bold text-slate-500">{cart.length} أصناف</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{products.map(product => <button key={product.id} type="button" onClick={() => addToCart(product)} disabled={product.stockQuantity < 1} className="flex min-h-20 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-right transition hover:border-teal-400 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-45"><span className="font-black text-slate-800">{product.name}</span><span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-500"><span>{product.category}</span><span>{money(product.sellingPrice)} · رصيد {product.stockQuantity}</span></span></button>)}</div>
        {!products.length && <Empty text="أضف أصناف المعرض ليظهروا هنا" />}
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">{cart.map(line => <div key={line.productId} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"><span className="min-w-32 flex-1 font-bold text-slate-800">{line.name}</span><Input aria-label={`كمية ${line.name}`} type="number" min="1" max={line.max} value={line.quantity} onChange={e => setCart(rows => rows.map(row => row.productId === line.productId ? { ...row, quantity: Math.max(1, Math.min(line.max, Number(e.target.value) || 1)) } : row))} className="h-8 w-20" /><span className="w-28 text-left font-black">{money(line.quantity * line.unitPrice)}</span><Button type="button" size="icon" variant="ghost" onClick={() => setCart(rows => rows.filter(row => row.productId !== line.productId))} aria-label="حذف الصنف"><Trash2 className="h-4 w-4 text-rose-600" /></Button></div>)}</div>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><div><Label>طريقة الدفع</Label><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant={paymentMethod === "cash" ? "default" : "outline"} onClick={() => { setPaymentMethod("cash"); setPaidAmount(""); }} className={paymentMethod === "cash" ? "bg-emerald-700 hover:bg-emerald-800" : ""}>كاش</Button><Button type="button" variant={paymentMethod === "credit" ? "default" : "outline"} onClick={() => { setPaymentMethod("credit"); setPaidAmount(""); }} className={paymentMethod === "credit" ? "bg-amber-600 hover:bg-amber-700" : ""}>آجل</Button></div></div><div className="rounded-xl bg-teal-50 p-3 text-center"><p className="text-xs font-bold text-teal-700">الإجمالي</p><p className="text-2xl font-black text-teal-900">{money(total)}</p></div></div>
        {paymentMethod === "credit" && <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="gallery-customer">اسم العميل</Label><Input id="gallery-customer" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="مطلوب للبيع الآجل" /></div><div><Label htmlFor="gallery-phone">رقم الهاتف</Label><Input id="gallery-phone" dir="ltr" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div><div><Label htmlFor="gallery-paid">الدفعة المقدمة</Label><Input id="gallery-paid" type="number" min="0" max={total} value={paidAmount} onChange={e => setPaidAmount(e.target.value)} /></div><div className="flex items-end"><div className="w-full rounded-lg bg-white px-3 py-2"><span className="text-xs font-bold text-slate-500">المتبقي</span><p className="font-black text-amber-800">{money(remaining)}</p></div></div></div><div><div className="mb-2 flex items-center justify-between"><Label>جدول الأقساط</Label><Button type="button" size="sm" variant="outline" onClick={addInstallment}><Plus className="ml-1 h-4 w-4" />قسط</Button></div>{installments.map((row, index) => <div key={index} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"><Input type="date" value={row.dueDate} onChange={e => setInstallments(rows => rows.map((item, i) => i === index ? { ...item, dueDate: e.target.value } : item))} /><Input type="number" min="1" value={row.amount} onChange={e => setInstallments(rows => rows.map((item, i) => i === index ? { ...item, amount: Number(e.target.value) } : item))} /><Button type="button" size="icon" variant="ghost" onClick={() => setInstallments(rows => rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-rose-600" /></Button></div>)}</div></div>}
        <Button type="button" onClick={submitSale} disabled={createSale.isPending || !cart.length} className="mt-4 h-11 w-full bg-teal-700 text-base font-black hover:bg-teal-800">{createSale.isPending ? "جارٍ حفظ الفاتورة…" : "حفظ البيع وإصدار الفاتورة"}</Button>
      </div>

      <div className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Boxes className="h-5 w-5 text-amber-700" /><h2 className="font-black">مخزون المعرض</h2></div><Button type="button" size="sm" variant="outline" onClick={() => setShowProductForm(value => !value)}><Plus className="ml-1 h-4 w-4" />صنف</Button></div>{showProductForm && <div className="mb-3 grid gap-2 rounded-xl bg-amber-50 p-3 sm:grid-cols-2"><Input placeholder="اسم الصنف" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} /><Input placeholder="التصنيف" value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })} /><Input type="number" placeholder="سعر البيع" value={productForm.sellingPrice} onChange={e => setProductForm({ ...productForm, sellingPrice: e.target.value })} /><Input type="number" placeholder="الرصيد الافتتاحي" value={productForm.stockQuantity} onChange={e => setProductForm({ ...productForm, stockQuantity: e.target.value })} /><Button type="button" className="sm:col-span-2 bg-amber-700 hover:bg-amber-800" onClick={() => createProduct.mutate({ name: productForm.name, category: productForm.category, sellingPrice: Number(productForm.sellingPrice), stockQuantity: Number(productForm.stockQuantity), reorderLevel: Number(productForm.reorderLevel) })}>حفظ الصنف</Button></div>}{products.map(product => <div key={product.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0"><div><p className="font-bold text-slate-800">{product.name}</p><p className="text-xs text-slate-500">{product.category} · {money(product.sellingPrice)}</p></div><span className={`rounded-full px-2 py-1 text-xs font-black ${product.stockQuantity <= product.reorderLevel ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>رصيد {product.stockQuantity}</span></div>)}</section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><Settings2 className="h-5 w-5 text-teal-700" /><h2 className="font-black">إعداد خزينة المعرض</h2></div><div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><p className="font-bold text-slate-800">دمج الإيرادات مع الخزينة الرئيسية</p><p className="mt-1 text-xs leading-5 text-slate-500">عند الإيقاف تُسجّل الإيرادات في خزينة المعرض فقط.</p></div><Switch checked={Boolean(settings?.mergeWithMainCash)} onCheckedChange={checked => settingsMutation.mutate({ mergeWithMainCash: checked })} /></div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><CalendarClock className="h-5 w-5 text-violet-700" /><h2 className="font-black">أقساط مستحقة</h2></div>{dashboard.data?.installments.slice(0, 5).map(row => <div key={row.id} className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-violet-50 p-2 text-sm"><div><p className="font-bold">استحقاق {new Date(row.dueDate).toLocaleDateString("ar-EG")}</p><p className="text-xs text-slate-500">{money(row.amount - row.paidAmount)}</p></div><Button type="button" size="sm" onClick={() => payInstallment.mutate({ installmentId: row.id, amount: row.amount - row.paidAmount })}>تحصيل</Button></div>)}{!dashboard.data?.installments.length && <Empty text="لا توجد أقساط مستحقة" />}</section></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><h2 className="font-black">مبيعات اليوم</h2></div>{dashboard.data?.sales.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-right text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-500"><th className="p-2">الفاتورة</th><th className="p-2">العميل</th><th className="p-2">الدفع</th><th className="p-2">الإجمالي</th><th className="p-2">المتبقي</th></tr></thead><tbody>{dashboard.data.sales.map(sale => <tr key={sale.id} className="border-b last:border-0"><td className="p-2 font-bold">{sale.invoiceNumber}</td><td className="p-2">{sale.customerName || "عميل نقدي"}</td><td className="p-2">{sale.paymentMethod === "cash" ? "كاش" : "آجل"}</td><td className="p-2 font-black">{money(sale.totalAmount)}</td><td className="p-2 font-bold text-amber-700">{money(sale.remainingAmount)}</td></tr>)}</tbody></table></div> : <Empty text="لا توجد مبيعات اليوم" />}</section>
  </main>;
}

function Summary({ icon, title, value, tone = "teal" }: { icon: ReactNode; title: string; value: string; tone?: "teal" | "emerald" | "amber" | "sky" }) { const colors = { teal: "bg-teal-50 text-teal-800", emerald: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-800", sky: "bg-sky-50 text-sky-800" }; return <div className={`rounded-2xl p-4 ${colors[tone]}`}><div className="mb-2 flex items-center gap-2 text-sm font-bold">{icon}<span>{title}</span></div><p className="text-xl font-black">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="py-6 text-center text-sm font-bold text-slate-400">{text}</div>; }
