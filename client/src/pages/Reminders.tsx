import { NotificationSettingsCard } from "@/components/NotificationSettingsCard";
import { PinVerificationDialog } from "@/components/PinVerificationDialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { reminderExcelHeaders, reminderRowsForExcel, downloadRowsAsExcel, withArabicHeaders } from "@/lib/excelExport";
import { printArabicPdf } from "@/lib/pdfExport";
import {
  buildWhatsAppReminderMessage,
  buildWhatsAppBulkReminderMessage,
  buildWhatsAppUrl,
  customerMapUrl,
  formatDate,
  visitTypeLabels,
  whatsappReminderStage,
  type WhatsAppReminderStage,
} from "@/lib/filterUi";
import { BellRing, Check, Copy, Download, MapPinned, MessageCircle, Phone, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const WHATSAPP_STATE_KEY = "water-filter-whatsapp-reminder-state";

type WhatsAppState = Record<string, string>;

function readWhatsAppState(): WhatsAppState {
  try {
    const value = window.localStorage.getItem(WHATSAPP_STATE_KEY);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export default function Reminders() {
  const queryOptions = { retry: false, staleTime: 5_000, refetchInterval: 8_000, refetchOnReconnect: true, refetchOnWindowFocus: false, networkMode: "online" as const };
  const { data: dueReminders, isLoading: dueLoading, isError: dueError } = trpc.filters.reminders.due.useQuery(undefined, queryOptions);
  const { data: alertReminders, isLoading: alertsLoading, isError: alertsError } = trpc.filters.reminders.alerts.useQuery(undefined, queryOptions);
  const { data: notificationSettings } = trpc.filters.notifications.settings.useQuery(undefined, queryOptions);
  const visibleDueReminders = Array.isArray(dueReminders) ? dueReminders : [];
  const visibleAlertReminders = Array.isArray(alertReminders) ? alertReminders : [];
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [whatsappState, setWhatsAppState] = useState<WhatsAppState>(readWhatsAppState);
  const [selectedReminderIds, setSelectedReminderIds] = useState<number[]>([]);
  const [bulkMessage, setBulkMessage] = useState("");
  const [pinAction, setPinAction] = useState<{ id: number; status: "completed" | "dismissed" } | null>(null);
  const [deleteReminderId, setDeleteReminderId] = useState<number | null>(null);
    const updateStatus = trpc.filters.reminders.updateStatus.useMutation({
    onSuccess: result => {
      utils.filters.reminders.due.invalidate();
      utils.filters.reminders.alerts.invalidate();
      utils.filters.dashboard.invalidate();
      utils.filters.customers.list.invalidate();
      toast.success(result.nextVisitCreated ? "تم تسجيل الزيارة وإنشاء موعد المتابعة القادم بعد ١٢٠ يومًا" : "تم تحديث حالة التذكير");
    },
    onError: error => toast.error(error.message || "تعذر تحديث حالة التذكير. يرجى المحاولة مرة أخرى."),
  });

  const deleteReminder = trpc.filters.reminders.delete.useMutation({ onSuccess: () => { utils.filters.reminders.due.invalidate(); utils.filters.reminders.alerts.invalidate(); utils.filters.dashboard.invalidate(); toast.success("تم حذف التذكير"); setDeleteReminderId(null); }, onError: error => toast.error(error.message || "تعذر حذف التذكير.") });

  const reminders = useMemo(() => {
    const map = new Map<number, NonNullable<typeof dueReminders>[number]>();
    [...visibleDueReminders, ...visibleAlertReminders].forEach(reminder => map.set(reminder.id, reminder));
    return Array.from(map.values()).sort((a, b) => new Date(a.reminderDate).getTime() - new Date(b.reminderDate).getTime());
  }, [visibleDueReminders, visibleAlertReminders]);

  const isLoading = dueLoading || alertsLoading;
  const isError = dueError || alertsError;
  const exportReminders = () => { if (!reminders.length) { toast.info("لا توجد تذكيرات مطابقة للتصدير"); return; } downloadRowsAsExcel(`تذكيرات-نقطة-نقاء-${new Date().toISOString().slice(0, 10)}.xlsx`, "التذكيرات", withArabicHeaders(reminderRowsForExcel(reminders), reminderExcelHeaders)); toast.success("تم تجهيز ملف التذكيرات للتنزيل"); };
  const exportRemindersPdf = () => { if (!reminders.length) { toast.info("لا توجد تذكيرات مطابقة للتصدير"); return; } const rows = withArabicHeaders(reminderRowsForExcel(reminders), reminderExcelHeaders); const opened = printArabicPdf("التذكيرات والمتابعة", rows, Object.entries(reminderExcelHeaders).map(([key, label]) => ({ key: label, label }))); if (opened) toast.success("تم تجهيز PDF للتذكيرات"); else toast.error("تعذر فتح نافذة PDF؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); };

  const markCustomerConfirmed = (reminder: (typeof reminders)[number]) => {
    const key = `${reminder.id}:confirmed`;
    const nextState = { ...whatsappState, [key]: new Date().toISOString() };
    setWhatsAppState(nextState);
    window.localStorage.setItem(WHATSAPP_STATE_KEY, JSON.stringify(nextState));
    toast.success("تم تسجيل تأكيد العميل على الجهاز");
  };

  const eligibleReminders = reminders.filter(reminder => reminder.customer?.phone && whatsappReminderStage(reminder.reminderDate));
  const selectedReminders = eligibleReminders.filter(reminder => selectedReminderIds.includes(reminder.id));

  const toggleReminderSelection = (id: number) => {
    setSelectedReminderIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const toggleAllEligible = () => {
    setSelectedReminderIds(current => current.length === eligibleReminders.length ? [] : eligibleReminders.map(reminder => reminder.id));
  };

  const shareBulkWhatsAppReminder = async () => {
    if (!selectedReminders.length) {
      toast.info("حدد عميلًا مستحقًا واحدًا على الأقل أولًا.");
      return;
    }
    const message = buildWhatsAppBulkReminderMessage(selectedReminders.map(reminder => ({ customerName: reminder.customer?.name, reminderDate: reminder.reminderDate })));
    setBulkMessage(message);
    try {
      await navigator.clipboard.writeText(message);
      toast.success("تم نسخ الرسالة الجماعية. استخدم زر واتساب بجانب كل عميل لإرسالها له.");
    } catch {
      toast.info("ظهرت الرسالة أسفل القائمة. حدّدها وانسخها ثم أرسلها لكل عميل.");
    }
  };

  const sendWhatsAppReminder = (reminder: (typeof reminders)[number], stage: WhatsAppReminderStage) => {
    const message = buildWhatsAppReminderMessage(reminder.customer?.name || "عميلنا الكريم", reminder.reminderDate, stage);
    const url = buildWhatsAppUrl(reminder.customer?.phone, message);
    if (!url) {
      toast.error("لا يوجد رقم هاتف صالح لهذا العميل.");
      return;
    }
    const key = `${reminder.id}:${stage}`;
    const nextState = { ...whatsappState, [key]: new Date().toISOString() };
    setWhatsAppState(nextState);
    window.localStorage.setItem(WHATSAPP_STATE_KEY, JSON.stringify(nextState));
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success(stage === "before" ? "تم تجهيز رسالة التذكير قبل الموعد." : "تم تجهيز رسالة متابعة يوم الموعد.");
  };

  if (isError) return <div className="soft-card p-8 text-center"><p className="font-bold text-teal-950">تعذر تحميل التذكيرات.</p><p className="mt-2 text-sm text-muted-foreground">تحقق من الاتصال ثم أعد المحاولة.</p><Button onClick={() => window.location.reload()} variant="outline" className="mt-4 rounded-xl">إعادة المحاولة</Button></div>;

  return (
    <>
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="page-heading">التذكيرات والمتابعة</h1><p className="page-subheading">رسالة واتساب جاهزة قبل الموعد بيوم، ورسالة متابعة يوم الموعد إذا لم يصل رد.</p><p className="mt-2 text-xs font-bold text-emerald-800">رقم واتساب الشركة: <span dir="ltr">{notificationSettings?.companyWhatsAppPhone?.trim() || "غير مسجل"}</span> — حدد المستحقين أو اضغط زر واتساب لفتح الرسالة الجاهزة ثم اضغط إرسال.</p></div><div className="flex flex-wrap gap-2"><Button onClick={exportReminders} variant="outline" className="h-11 shrink-0 rounded-xl"><Download className="ml-2 h-4 w-4" />Excel</Button><Button onClick={exportRemindersPdf} variant="outline" className="h-11 shrink-0 rounded-xl"><Download className="ml-2 h-4 w-4" />PDF</Button></div></div>
      <NotificationSettingsCard />
      <section className="soft-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-teal-950/6 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-amber-700"><BellRing className="h-5 w-5" /></div><div><h2 className="font-extrabold">قائمة المتابعة</h2><p className="mt-1 text-xs text-muted-foreground">{isLoading ? "جارٍ التحميل…" : `${reminders.length} تذكير ظاهر — ${eligibleReminders.length} مستحق للرسائل`}</p></div></div><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={toggleAllEligible} disabled={!eligibleReminders.length} title={eligibleReminders.length ? "تحديد العملاء المستحقين للرسالة" : "لا يوجد عميل مستحق اليوم أو غدًا أو متأخر"} className="rounded-lg">{selectedReminders.length === eligibleReminders.length && eligibleReminders.length ? "إلغاء تحديد المستحقين" : "تحديد المستحقين"}</Button><Button type="button" size="sm" onClick={shareBulkWhatsAppReminder} disabled={!selectedReminders.length} title={selectedReminders.length ? "فتح رسالة واتساب للمستحقين المحددين" : "حدد مستحقًا واحدًا على الأقل أولًا"} className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Copy className="ml-1 h-4 w-4" />نسخ رسالة المستحقين ({selectedReminders.length})</Button></div></div>
        {bulkMessage ? <div className="mx-5 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-extrabold text-emerald-950">الرسالة الجماعية جاهزة للنسخ</p>
            <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(bulkMessage).then(() => toast.success("تم نسخ الرسالة مرة أخرى")).catch(() => toast.info("حدد النص وانسخه يدويًا"))} className="rounded-lg border-emerald-300 text-emerald-800"><Copy className="ml-1 h-4 w-4" />نسخ مرة أخرى</Button>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-emerald-950">{bulkMessage}</p>
          <p className="mt-2 text-xs font-bold text-emerald-800">لأن واتساب العادي لا يرسل رسالة واحدة لعدة أرقام عبر الرابط، استخدم زر «واتساب» بجانب كل مستحق لإرسال رسالة مخصصة له.</p>
        </div> : null}
        <div className="divide-y divide-teal-950/6">
          {reminders.length ? reminders.map(reminder => {
            const mapUrl = reminder.customer ? customerMapUrl(reminder.customer) : null;
            const stage = whatsappReminderStage(reminder.reminderDate);
            const sentAt = stage ? whatsappState[`${reminder.id}:${stage}`] : null;
            const confirmedAt = whatsappState[`${reminder.id}:confirmed`];
            const showWhatsAppButton = Boolean(stage && (stage !== "today" || !confirmedAt));
            return (
              <div key={reminder.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <input type="checkbox" aria-label={`تحديد ${reminder.customer?.name || "العميل"} للرسالة الجماعية`} checked={selectedReminderIds.includes(reminder.id)} onChange={() => toggleReminderSelection(reminder.id)} disabled={!stage || !reminder.customer?.phone} className="mt-1 h-4 w-4 accent-emerald-600" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><button onClick={() => setLocation(`/customers/${reminder.customerId}`)} className="font-extrabold text-teal-900 hover:text-teal-600">{reminder.customer?.name || "عميل"}</button>{reminder.customer?.customerCode ? <span className="text-sm font-extrabold text-teal-800" dir="ltr">{reminder.customer.customerCode}</span> : null}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span dir="ltr">{reminder.customer?.phone}</span><span>موعد المتابعة {formatDate(reminder.reminderDate)}</span>{reminder.lastServiceVisitType && reminder.lastServiceVisitDate ? <span>آخر خدمة: {visitTypeLabels[reminder.lastServiceVisitType as keyof typeof visitTypeLabels]} — {formatDate(reminder.lastServiceVisitDate)}</span> : null}<span className={reminder.daysOverdue ? "font-bold text-rose-700" : "font-bold text-amber-700"}>{reminder.daysOverdue ? `متأخر ${reminder.daysOverdue} يوم` : "متابعة قريبة"}</span>{sentAt ? <span className="font-bold text-emerald-700">تم تجهيز رسالة واتساب</span> : null}{confirmedAt ? <span className="font-bold text-sky-700">تم تسجيل تأكيد العميل</span> : null}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2"><a href={`tel:${reminder.customer?.phone || ""}`} className="inline-flex h-9 items-center rounded-lg bg-teal-50 px-3 text-sm font-bold text-teal-800 hover:bg-teal-100"><Phone className="ml-1.5 h-4 w-4" />اتصال</a>{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg bg-sky-50 px-3 text-sm font-bold text-sky-800 hover:bg-sky-100"><MapPinned className="ml-1.5 h-4 w-4" />الموقع</a> : null}{showWhatsAppButton ? <Button size="sm" onClick={() => sendWhatsAppReminder(reminder, stage!)} className="h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><MessageCircle className="ml-1 h-4 w-4" />{stage === "before" ? "واتساب قبل الموعد" : stage === "overdue" ? "واتساب للمتأخر" : "واتساب اليوم"}</Button> : null}{stage === "today" && !confirmedAt ? <Button size="sm" variant="outline" onClick={() => markCustomerConfirmed(reminder)} className="h-9 rounded-lg border-sky-200 text-sky-800 hover:bg-sky-50"><Check className="ml-1 h-4 w-4" />تم تأكيد العميل</Button> : null}<Button size="sm" disabled={updateStatus.isPending} onClick={() => setPinAction({ id: reminder.id, status: "completed" })} className="h-9 rounded-lg bg-teal-700 hover:bg-teal-800"><Check className="ml-1 h-4 w-4" />تمت</Button><Button size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => setPinAction({ id: reminder.id, status: "dismissed" })} className="h-9 rounded-lg border-amber-200 text-amber-800 hover:bg-amber-50"><X className="ml-1 h-4 w-4" />تجاوز</Button><Button size="sm" variant="outline" onClick={() => setDeleteReminderId(reminder.id)} className="h-9 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50">حذف</Button></div>
              </div>
            );
          }) : <div className="p-14 text-center"><BellRing className="mx-auto h-8 w-8 text-teal-200" /><p className="mt-3 text-sm text-muted-foreground">لا توجد تذكيرات قريبة أو مستحقة حاليًا.</p></div>}
        </div>
      </section>
    </div>
      <PinVerificationDialog open={pinAction !== null} onOpenChange={open => { if (!open) setPinAction(null); }} busy={updateStatus.isPending} title={pinAction?.status === "completed" ? "تأكيد إتمام المتابعة" : "تأكيد تجاوز التذكير"} onConfirm={pin => { if (pinAction) updateStatus.mutate({ ...pinAction, pin }); }} />
      <PinVerificationDialog open={deleteReminderId !== null} onOpenChange={open => { if (!open) setDeleteReminderId(null); }} busy={deleteReminder.isPending} title="تأكيد حذف التذكير" description="سيتم حذف التذكير المحدد نهائيًا من السجل." onConfirm={pin => { if (deleteReminderId !== null) deleteReminder.mutate({ id: deleteReminderId, pin }); }} />
    </>
  );
}
