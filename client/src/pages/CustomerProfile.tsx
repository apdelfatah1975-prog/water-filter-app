import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerContactActions } from "@/components/CustomerContactActions";
import { PinVerificationDialog } from "@/components/PinVerificationDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UsedItemsSection, addOrIncrementVisitItem, buildPartsConfirmation, type CatalogItem, type UsedVisitItem } from "@/pages/Customers";
import { trpc } from "@/lib/trpc";
import { formatDateTime, reminderStatusLabels, toDateTimeLocal, visitTypeLabels } from "@/lib/filterUi";
import { FOLLOW_UP_DAYS } from "@shared/filterBusiness";
import { printCustomerProfile, printCustomerReminders, printCustomerSummary, printCustomerVisits, printVisitReport, type CustomerProfileReportInput } from "@/lib/pdfExport";
import { ArrowRight, BellRing, CalendarClock, CalendarPlus, Edit3, FileText, Loader2, Printer } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

function daysLabel(daysRemaining: number) {
  if (daysRemaining < 0) return `متأخر ${Math.abs(daysRemaining)} يوم`;
  if (daysRemaining === 0) return "موعده اليوم";
  return `متبقي ${daysRemaining} يوم`;
}

export default function CustomerProfile() {
  const [, params] = useRoute("/customers/:id");
  const customerId = Number(params?.id);
  const queryInput = useMemo(() => ({ id: customerId }), [customerId]);
  const { data, isLoading } = trpc.filters.customers.get.useQuery(queryInput, { enabled: Number.isFinite(customerId), retry: false });
  const resolvedData = data;
  const { data: notificationSettings } = trpc.filters.notifications.settings.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const { data: inventoryData } = trpc.filters.inventory.summary.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const techniciansQuery = trpc.filters.technicians?.list?.useQuery?.(undefined, { retry: false, staleTime: 60_000 });
  const visibleTechnicians = techniciansQuery?.data ?? [];
  const catalogItems: CatalogItem[] = (inventoryData?.items ?? []).map(item => ({ id: item.id, name: item.name, unit: item.unit, currentBalance: item.currentBalance }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pdfPartsOpen, setPdfPartsOpen] = useState(false);
  const [visitType, setVisitType] = useState<keyof typeof visitTypeLabels>("maintenance");
  const [visitDate, setVisitDate] = useState(toDateTimeLocal());
  const [visitFollowUpDays, setVisitFollowUpDays] = useState(String(FOLLOW_UP_DAYS));
  const [notes, setNotes] = useState("");
  const [visitResult, setVisitResult] = useState("");
  const [visitTechnicianName, setVisitTechnicianName] = useState("");
  const [visitTechnicianId, setVisitTechnicianId] = useState("");
  const [visitCollectedAmount, setVisitCollectedAmount] = useState("");
  const [visitTdsIn, setVisitTdsIn] = useState("");
  const [visitTdsOut, setVisitTdsOut] = useState("");
  const [visitItems, setVisitItems] = useState<UsedVisitItem[]>([]);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemQuantity, setManualItemQuantity] = useState("1");
  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [visitPinOpen, setVisitPinOpen] = useState(false);
  const [editingVisitDate, setEditingVisitDate] = useState(toDateTimeLocal());
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const updateVisitDate = trpc.filters.visits.updateDate.useMutation({
    onSuccess: () => {
      utils.filters.customers.get.invalidate(queryInput);
      utils.filters.customers.list.invalidate();
      utils.filters.dashboard.invalidate();
      utils.filters.reminders.due.invalidate();
      toast.success("تم تعديل تاريخ ووقت الخدمة وتحديث موعد المتابعة");
      setEditingVisitId(null);
    },
    onError: error => toast.error(error.message || "تعذر تعديل الخدمة"),
  });
  useEffect(() => {
    const shouldOpenVisit = new URLSearchParams(window.location.search).get("openVisit") === "1";
    if (shouldOpenVisit && data) {
      setDialogOpen(true);
      setVisitType("maintenance");
      setVisitDate(toDateTimeLocal());
      setNotes(""); setVisitResult(""); setVisitTechnicianName(""); setVisitTechnicianId(""); setVisitCollectedAmount(""); setVisitTdsIn(""); setVisitTdsOut(""); setVisitFollowUpDays(String(FOLLOW_UP_DAYS)); setVisitItems([]); setManualItemName(""); setManualItemQuantity("1");
      window.history.replaceState({}, "", `/customers/${customerId}`);
    }
  }, [customerId, data]);

  const createVisit = trpc.filters.visits.create.useMutation({
    onSuccess: result => {
      utils.filters.customers.get.invalidate(queryInput);
      utils.filters.customers.list.invalidate();
      utils.filters.dashboard.invalidate();
      utils.filters.reminders.due.invalidate();
      toast.success(result.reminderCreated ? "تم تسجيل الزيارة وإنشاء تذكير بعد 120 يومًا" : "تم تسجيل الزيارة بنجاح");
      setDialogOpen(false);
      setNotes(""); setVisitResult(""); setVisitTechnicianName(""); setVisitTechnicianId(""); setVisitCollectedAmount(""); setVisitTdsIn(""); setVisitTdsOut(""); setVisitFollowUpDays(String(FOLLOW_UP_DAYS)); setVisitItems([]); setManualItemName(""); setManualItemQuantity("1");
    },
    onError: error => toast.error(error.message || "تعذر تسجيل الزيارة. يرجى المحاولة مرة أخرى."),
  });

  if (isLoading && !resolvedData) return <div className="grid min-h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>;
  if (!resolvedData) return <div className="soft-card p-8 text-center"><p className="font-bold">تعذر العثور على العميل في بيانات السيرفر.</p><Button onClick={() => setLocation("/customers")} variant="outline" className="mt-4 rounded-xl">العودة للعملاء</Button></div>;

  const { customer } = resolvedData;
  const customerCode = customer.customerCode ?? customer.id;
  const followUp = customer.followUp;
  const installationVisit = resolvedData.visits.filter(visit => visit.visitType === "installation").sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime())[0];
  const getProfileReport = (): CustomerProfileReportInput => ({ companyName: notificationSettings?.companyName, customerName: customer.name, customerCode, phone: customer.phone, address: customer.address, location: customer.latitude && customer.longitude ? `${customer.latitude}, ${customer.longitude}` : null, filterType: null, installationDate: installationVisit?.visitDate, notes: customer.notes, nextFollowUpDate: followUp?.nextVisitDate, visits: resolvedData.visits.map(visit => ({ visitType: visitTypeLabels[visit.visitType], visitDate: visit.visitDate, technicianName: visit.technicianName, tdsIn: visit.tdsIn, tdsOut: visit.tdsOut, collectedAmount: (visit as { collectedAmount?: number | null }).collectedAmount, notes: visit.visitResult || visit.notes })) });

  function submitVisit(event: FormEvent) {
    event.preventDefault();
    const collectedAmount = Math.round(Number.parseFloat(visitCollectedAmount) || 0);
    const rawFollowUpDays = visitFollowUpDays.trim();
    const selectedFollowUpDays = rawFollowUpDays === "" ? undefined : Number(rawFollowUpDays);
    if (selectedFollowUpDays !== undefined && (!Number.isInteger(selectedFollowUpDays) || selectedFollowUpDays < 0 || selectedFollowUpDays > 3650)) return toast.error("أدخل عدد أيام صحيحًا بين 0 و3650، أو اترك الحقل فارغًا لاستخدام 120 يومًا تلقائيًا.");
    const payload = { customerId, visitType, visitDate: new Date(visitDate), ...(selectedFollowUpDays === undefined ? {} : { followUpDays: selectedFollowUpDays }), technicianName: visitTechnicianName || null, assignedTechnicianId: visitTechnicianId ? Number(visitTechnicianId) : null, tdsIn: visitTdsIn.trim() ? Math.round(Number(visitTdsIn)) : null, tdsOut: visitTdsOut.trim() ? Math.round(Number(visitTdsOut)) : null, visitResult: visitResult || null, collectedAmount, collectedCurrency: "SAR" as const, notes: notes || null, items: visitItems.filter(item => item.quantity > 0) };
    if (payload.items.length > 0 && !window.confirm(buildPartsConfirmation(payload.items, catalogItems))) return;
    createVisit.mutate(payload);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button onClick={() => setLocation("/customers")} className="inline-flex items-center text-sm font-bold text-teal-700"><ArrowRight className="ml-1 h-4 w-4" />العودة إلى العملاء</button>
      <section className="soft-card overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#064e4a,#0f766e)] p-6 text-white sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-teal-100">ملف العميل</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold">{customer.name}</h1><span className="text-lg font-extrabold text-white" dir="ltr">{customerCode}</span></div>
            <p className="mt-2 text-sm text-teal-50/80" dir="ltr">{customer.phone}</p>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2 sm:mt-0"><Button type="button" variant="outline" onClick={() => { const opened = printCustomerProfile({ companyName: notificationSettings?.companyName, customerName: customer.name, customerCode, phone: customer.phone, address: customer.address, location: customer.latitude && customer.longitude ? `${customer.latitude}, ${customer.longitude}` : null, filterType: null, installationDate: installationVisit?.visitDate, notes: customer.notes, nextFollowUpDate: followUp?.nextVisitDate, visits: resolvedData.visits.map(visit => ({ visitType: visitTypeLabels[visit.visitType], visitDate: visit.visitDate, technicianName: visit.technicianName, tdsIn: visit.tdsIn, tdsOut: visit.tdsOut, collectedAmount: (visit as { collectedAmount?: number | null }).collectedAmount, notes: visit.visitResult || visit.notes })) }); if (opened) toast.success("تم تجهيز ملف العميل للطباعة أو الحفظ PDF"); else toast.error("تعذر فتح التقرير؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); }} className="rounded-xl border-white/70 bg-white/10 text-white hover:bg-white/20"><Printer className="ml-2 h-4 w-4" />طباعة ملف العميل / PDF</Button><Button type="button" variant="outline" onClick={() => setPdfPartsOpen(true)} className="rounded-xl border-white/70 bg-white/10 text-white hover:bg-white/20"><FileText className="ml-2 h-4 w-4" />تصدير قسم من الملف</Button><Button onClick={() => { setVisitType("maintenance"); setVisitDate(toDateTimeLocal()); setNotes(""); setVisitResult(""); setVisitTechnicianName(""); setVisitTechnicianId(""); setVisitCollectedAmount(""); setVisitTdsIn(""); setVisitTdsOut(""); setVisitFollowUpDays(String(FOLLOW_UP_DAYS)); setVisitItems([]); setManualItemName(""); setManualItemQuantity("1"); setDialogOpen(true); }} className="rounded-xl bg-white text-teal-800 hover:bg-teal-50"><CalendarPlus className="ml-2 h-4 w-4" />تسجيل زيارة</Button></div>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-3">
          <div><p className="text-xs font-bold text-muted-foreground">العنوان</p><p className="mt-2 text-sm leading-6">{customer.address || "غير مسجل"}</p></div>
          <div><p className="text-xs font-bold text-muted-foreground">الموقع GPS</p><p className="mt-2 text-sm" dir="ltr">{customer.latitude && customer.longitude ? `${customer.latitude}, ${customer.longitude}` : "غير مسجل"}</p></div>
          <CustomerContactActions customer={customer} labels className="items-end" />
        </div>
        {customer.notes ? <div className="border-t border-teal-950/6 bg-teal-50/35 px-6 py-4 text-sm leading-7 text-muted-foreground"><span className="font-bold text-teal-950">ملاحظات: </span>{customer.notes}</div> : null}
      </section>
      <section className="soft-card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-teal-950/6 bg-teal-50/40 p-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-700 text-white"><CalendarClock className="h-5 w-5" /></div><div><h2 className="font-extrabold">الموعد القادم</h2><p className="mt-1 text-xs text-muted-foreground">يُحتسب تلقائيًا بعد 120 يومًا من آخر تركيب أو صيانة.</p></div></div>
        {followUp ? <div className="grid gap-4 p-5 sm:grid-cols-4"><div><p className="text-xs font-bold text-muted-foreground">موعد المتابعة</p><p className="mt-2 font-extrabold text-teal-950">{formatDateTime(followUp.nextVisitDate)}</p></div><div><p className="text-xs font-bold text-muted-foreground">عدد الأيام</p><p className="mt-2 font-extrabold text-sky-700">{followUp.followUpDays ?? FOLLOW_UP_DAYS} يوماً</p></div><div><p className="text-xs font-bold text-muted-foreground">الحالة</p><p className={`mt-2 font-extrabold ${followUp.daysRemaining < 0 ? "text-rose-700" : "text-teal-700"}`}>{daysLabel(followUp.daysRemaining)}</p></div><div><p className="text-xs font-bold text-muted-foreground">آخر زيارة محسوبة</p><p className="mt-2 font-bold">{visitTypeLabels[followUp.lastServiceVisitType]} <span className="font-normal text-muted-foreground">— {formatDateTime(followUp.lastServiceVisitDate)}</span></p></div></div> : <p className="p-5 text-sm leading-7 text-muted-foreground">لا يوجد موعد متابعة بعد؛ سجّل زيارة من نوع تركيب أو صيانة لإنشائه تلقائيًا.</p>}
      </section>
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="soft-card lg:col-span-2"><div className="flex items-center justify-between border-b border-teal-950/6 p-5"><div><h2 className="font-extrabold">سجل الزيارات</h2><p className="mt-1 text-xs text-muted-foreground">جميع الزيارات المسجلة للعميل مرتبة من الأحدث.</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">{resolvedData.visits.length} زيارة</span></div><div className="divide-y divide-teal-950/6">{resolvedData.visits.length ? resolvedData.visits.map(visit => <div key={visit.id} className="flex gap-4 p-5"><div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-teal-500 ring-4 ring-teal-50" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="secondary" className="bg-teal-50 text-teal-800">{visitTypeLabels[visit.visitType]}</Badge><div className="flex items-center gap-2"><p className="text-xs font-bold text-muted-foreground">{formatDateTime(visit.visitDate)}</p><Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-2 text-teal-700" onClick={() => { setEditingVisitId(visit.id); setEditingVisitDate(toDateTimeLocal(new Date(visit.visitDate))); }}><Edit3 className="ml-1 h-3.5 w-3.5" />تعديل</Button><Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-2 text-sky-700" onClick={() => { const opened = printVisitReport({ customerName: customer.name, customerPhone: customer.phone, customerAddress: customer.address, visitType: visitTypeLabels[visit.visitType], visitDate: visit.visitDate, technicianName: visit.technicianName, tdsIn: visit.tdsIn, tdsOut: visit.tdsOut, collectedAmount: (visit as { collectedAmount?: number | null }).collectedAmount, currency: (visit as { collectedCurrency?: string | null }).collectedCurrency, visitResult: (visit as { visitResult?: string | null }).visitResult, notes: visit.notes }); if (opened) toast.success("تم تجهيز تقرير الزيارة للطباعة"); else toast.error("تعذر فتح نافذة التقرير؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); }}><FileText className="ml-1 h-3.5 w-3.5" />PDF</Button></div></div>{visit.notes ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{visit.notes}</p> : null}{visit.tdsIn !== null || visit.tdsOut !== null ? <p className="mt-2 text-sm font-bold text-sky-800">TDS: دخول {visit.tdsIn ?? "—"} ppm · خروج {visit.tdsOut ?? "—"} ppm</p> : null}</div></div>) : <div className="p-10 text-center text-sm text-muted-foreground">لا توجد زيارات سابقة لهذا العميل.</div>}</div></div>
        <div className="soft-card"><div className="flex items-center gap-2 border-b border-teal-950/6 p-5"><BellRing className="h-5 w-5 text-amber-500" /><div><h2 className="font-extrabold">التذكيرات</h2><p className="mt-1 text-xs text-muted-foreground">متابعة الصيانة</p></div></div><div className="divide-y divide-teal-950/6">{resolvedData.reminders.length ? resolvedData.reminders.map(reminder => <div key={reminder.id} className="p-4"><Badge variant="secondary" className={reminder.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}>{reminderStatusLabels[reminder.status]}</Badge><p className="mt-2 text-sm font-bold">{formatDateTime(reminder.reminderDate)}</p></div>) : <div className="p-8 text-center text-sm text-muted-foreground">لا يوجد تذكير مسجل.</div>}</div></div>
      </section>
      <Dialog open={pdfPartsOpen} onOpenChange={setPdfPartsOpen}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>اختيار جزء التقرير</DialogTitle><DialogDescription>يمكنك طباعة كل تعاملات العميل أو اختيار قسم مستقل حسب الحاجة.</DialogDescription></DialogHeader><div className="grid gap-3 py-3"><Button type="button" className="min-h-12 rounded-xl bg-teal-700 hover:bg-teal-800" onClick={() => { const opened = printCustomerProfile(getProfileReport()); setPdfPartsOpen(false); if (!opened) toast.error("تعذر فتح نافذة التقرير؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); }}>كل تعاملات العميل</Button><Button type="button" variant="outline" className="min-h-12 rounded-xl" onClick={() => { const opened = printCustomerSummary(getProfileReport()); setPdfPartsOpen(false); if (!opened) toast.error("تعذر فتح نافذة التقرير"); }}>بيانات العميل</Button><Button type="button" variant="outline" className="min-h-12 rounded-xl" onClick={() => { const opened = printCustomerVisits(getProfileReport()); setPdfPartsOpen(false); if (!opened) toast.error("تعذر فتح نافذة التقرير"); }}>سجل الزيارات والتحصيل وTDS</Button><Button type="button" variant="outline" className="min-h-12 rounded-xl" onClick={() => { const opened = printCustomerReminders(getProfileReport()); setPdfPartsOpen(false); if (!opened) toast.error("تعذر فتح نافذة التقرير"); }}>موعد المتابعة</Button></div></DialogContent></Dialog>
      <Dialog open={editingVisitId !== null} onOpenChange={open => { if (!open) setEditingVisitId(null); }}><DialogContent dir="rtl"><DialogHeader><DialogTitle>تعديل تاريخ ووقت الخدمة</DialogTitle></DialogHeader><form onSubmit={event => { event.preventDefault(); if (editingVisitId !== null) setVisitPinOpen(true); }} className="space-y-4 py-2"><label><span className="field-label">تاريخ ووقت الخدمة</span><input type="datetime-local" className="field-input" value={editingVisitDate} onChange={event => setEditingVisitDate(event.target.value)} required /></label><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setEditingVisitId(null)} className="rounded-xl">إلغاء</Button><Button type="submit" disabled={updateVisitDate.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800">{updateVisitDate.isPending ? "جارٍ الحفظ…" : "حفظ التعديل"}</Button></div></form></DialogContent></Dialog>
      <PinVerificationDialog open={visitPinOpen} onOpenChange={open => { if (!open) setVisitPinOpen(false); }} busy={updateVisitDate.isPending} title="تأكيد تعديل تاريخ الزيارة" onConfirm={pin => { if (editingVisitId !== null) updateVisitDate.mutate({ visitId: editingVisitId, visitDate: new Date(editingVisitDate), pin }); }} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent dir="rtl" className="flex max-h-[90vh] flex-col overflow-hidden"><DialogHeader className="shrink-0"><DialogTitle>تسجيل زيارة جديدة</DialogTitle><DialogDescription>للعميل: {customer.name} — {customerCode}</DialogDescription></DialogHeader><form onSubmit={submitVisit} className="min-h-0 space-y-4 overflow-y-auto py-2 pl-1"><label><span className="field-label">نوع الزيارة</span><select className="field-input" value={visitType} onChange={event => setVisitType(event.target.value as keyof typeof visitTypeLabels)}>{Object.entries(visitTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="field-label">تاريخ ووقت الزيارة</span><input type="datetime-local" className="field-input" value={visitDate} onChange={event => setVisitDate(event.target.value)} required /></label><label><span className="field-label">اسم الفني</span><select aria-label="اسم الفني" className="field-input" value={visitTechnicianId} onChange={event => { const id = event.target.value; const technician = visibleTechnicians.find(item => String(item.id) === id); setVisitTechnicianId(id); setVisitTechnicianName(technician?.name ?? ""); }}><option value="">اختر الفني</option>{visibleTechnicians.map(technician => <option key={technician.id} value={String(technician.id)}>{technician.name ?? "فني بدون اسم"}</option>)}</select></label><label><span className="field-label">المبلغ المحصل</span><input type="number" inputMode="numeric" min="0" step="1" className="field-input min-h-12 w-full text-lg" value={visitCollectedAmount} onChange={event => setVisitCollectedAmount(event.target.value)} placeholder="مثال: 250" /></label><label><span className="field-label">عدد أيام المتابعة بعد الزيارة</span><input type="number" inputMode="numeric" min="0" max="3650" step="1" className="field-input" value={visitFollowUpDays} onChange={event => setVisitFollowUpDays(event.target.value)} placeholder={`اتركه فارغًا للحساب التلقائي بعد ${FOLLOW_UP_DAYS} يومًا`} /><span className="mt-1 block text-xs font-bold text-muted-foreground">اكتب أي عدد أيام، أو اترك الحقل فارغًا ليحسب التطبيق {FOLLOW_UP_DAYS} يومًا تلقائياً.</span></label><div className="grid gap-3 sm:grid-cols-2"><label><span className="field-label">نسبة أملاح مياه الدخول (TDS In - ppm)</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={visitTdsIn} onChange={event => setVisitTdsIn(event.target.value)} placeholder="اختياري" /></label><label><span className="field-label">نسبة أملاح مياه الخروج (TDS Out - ppm)</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={visitTdsOut} onChange={event => setVisitTdsOut(event.target.value)} placeholder="اختياري" /></label></div><label><span className="field-label">نتيجة الزيارة</span><textarea className="field-textarea" value={visitResult} onChange={event => setVisitResult(event.target.value)} placeholder="ما الذي تم تنفيذه؟" /></label><label><span className="field-label">ملاحظات الزيارة</span><textarea className="field-textarea" value={notes} onChange={event => setNotes(event.target.value)} placeholder="اكتب تفاصيل مختصرة عن الخدمة" /></label><UsedItemsSection items={visitItems} setItems={setVisitItems} catalogItems={catalogItems} manualName={manualItemName} setManualName={setManualItemName} manualQuantity={manualItemQuantity} setManualQuantity={setManualItemQuantity} onAdd={() => { const item = catalogItems.find(entry => entry.name.trim() === manualItemName.trim()); const quantity = Number.parseInt(manualItemQuantity, 10); if (!item) { toast.error("الصنف غير موجود في المخزن؛ أضفه أولًا من صفحة المخزن."); return; } if (!Number.isInteger(quantity) || quantity <= 0) { toast.error("أدخل كمية صحيحة أكبر من صفر."); return; } const selected = visitItems.find(entry => entry.inventoryItemId === item.id)?.quantity ?? 0; if (item.currentBalance !== undefined && item.currentBalance <= 0) { toast.error(`الصنف ${item.name} غير متوفر حاليًا؛ الرصيد صفر.`); return; } if (item.currentBalance !== undefined && selected + quantity > item.currentBalance) { toast.error(`الرصيد المتاح من ${item.name}: ${item.currentBalance}`); return; } setVisitItems(current => addOrIncrementVisitItem(current, item, quantity)); setManualItemName(""); setManualItemQuantity("1"); }} onQuickAdd={item => setVisitItems(current => addOrIncrementVisitItem(current, item))} listId="profile-visit-inventory-items" /><div className="sticky bottom-0 flex justify-end gap-3 border-t border-teal-100 bg-white/95 pt-3 backdrop-blur"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">إلغاء</Button><Button type="submit" disabled={createVisit.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800">{createVisit.isPending ? "جارٍ التسجيل…" : "حفظ الزيارة"}</Button></div></form></DialogContent></Dialog>
    </div>
  );
}
