import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cacheOfflineDashboard, downloadOfflineBackup, getOfflineBackupKeyCount, restoreOfflineBackupFromExcel } from "@/lib/offlineSync";
import { formatDateTime, visitTypeLabels } from "@/lib/filterUi";
import { printArabicPdf } from "@/lib/pdfExport";
import { AppSettings, getAppSettings } from "@/lib/appSettings";
import { getTrashItems } from "@/lib/trashBin";
import { ReminderAlertBanner } from "@/components/ReminderAlertBanner";
import { ArrowLeft, BellRing, CalendarDays, CheckCircle2, ChevronLeft, CircleDollarSign, ClipboardList, CloudDownload, CloudOff, CloudUpload, Download, Droplets, Filter, Info, PackageSearch, Printer, Refrigerator, RefreshCw, Snowflake, Trash2, Upload, UserPlus, UsersRound } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { extractArray } from "@/lib/dataNormalization";

function inventoryVisual(category?: string | null, name?: string) {
  const value = `${category ?? ""} ${name ?? ""}`;
  if (value.includes("مبرد") || value.includes("ثلاج")) return { icon: Refrigerator, tone: "bg-sky-100 text-sky-700", label: "مبردة" };
  if (value.includes("قارور") || value.includes("زجاج") || value.includes("عبو")) return { icon: Droplets, tone: "bg-cyan-100 text-cyan-700", label: "قارورة" };
  if (value.includes("فلتر") || value.includes("شمع") || value.includes("ممبرين")) return { icon: Filter, tone: "bg-teal-100 text-teal-700", label: category || "فلتر" };
  if (value.includes("ثلج") || value.includes("تبريد")) return { icon: Snowflake, tone: "bg-indigo-100 text-indigo-700", label: category || "تبريد" };
  return { icon: PackageSearch, tone: "bg-violet-100 text-violet-700", label: category || "صنف" };
}
function inventoryBalanceTone(currentBalance: number, reorderLevel: number) {
  if (currentBalance <= 0) return "bg-rose-100 text-rose-700";
  if (currentBalance <= reorderLevel) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

const statStyles = [
  { icon: BellRing, color: "bg-amber-500", label: "مستحقون للمتابعة", key: "due", href: "/reminders" },
  { icon: UsersRound, color: "bg-teal-700", label: "عملاء اليوم", key: "today", href: "/customers" },
  { icon: CalendarDays, color: "bg-sky-600", label: "زيارات قادمة", key: "upcoming", href: "/visits" },
  { icon: CircleDollarSign, color: "bg-slate-800", label: "رصيد الخزينة", key: "cash", href: "/cash" },
  { icon: PackageSearch, color: "bg-violet-600", label: "أصناف بالمخزن", key: "inventory", href: "/inventory" },
] as const;

export default function Home() {
  const { data, isLoading: dashboardLoading } = trpc.filters.dashboard.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  type DashboardData = NonNullable<typeof data>;
  const [appSettings, setAppSettings] = React.useState<AppSettings>(() => getAppSettings());
  const [online, setOnline] = React.useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [trashCount, setTrashCount] = React.useState(() => getTrashItems().length);
  const restoreInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const lowStockItems = extractArray<{ id: number; name: string; currentBalance: number; reorderLevel?: number | null }>(data?.inventory?.items).filter(item => item.currentBalance <= (item.reorderLevel ?? 2));
    if (!lowStockItems.length || typeof window === "undefined") return;
    const signature = lowStockItems.slice(0, 8).map(item => `${item.id}:${item.currentBalance}:${item.reorderLevel ?? 2}`).join("|");
    const storageKey = "purepoint-low-stock-alert";
    if (window.localStorage.getItem(storageKey) === signature) return;
    const names = lowStockItems.slice(0, 3).map(item => `${item.name} (${item.currentBalance})`).join("، ");
    toast.warning(`تنبيه المخزن: ${names}`, { description: `يوجد ${lowStockItems.length.toLocaleString("ar-SA")} أصناف عند الحد الأدنى أو أقل. يُرجى مراجعة المخزن.` });
    window.localStorage.setItem(storageKey, signature);
  }, [data?.inventory?.items]);
  React.useEffect(() => {
    const onSettingsChange = (event: Event) => setAppSettings((event as CustomEvent<AppSettings>).detail);
    window.addEventListener("purepoint-settings-changed", onSettingsChange);
    return () => window.removeEventListener("purepoint-settings-changed", onSettingsChange);
  }, []);
  React.useEffect(() => {
    const refreshStatus = () => {
      setTrashCount(getTrashItems().length);
    };
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    refreshStatus();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("purepoint-trash-bin-changed", refreshStatus);
    const interval = window.setInterval(refreshStatus, 1500);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("purepoint-trash-bin-changed", refreshStatus);
      window.clearInterval(interval);
    };
  }, []);
  React.useEffect(() => {
    if (!data) return;
    cacheOfflineDashboard(data);
  }, [data]);
  const sourceData = data;
  const displayData = React.useMemo<DashboardData | null>(() => sourceData ? {
    ...sourceData,
    todayVisits: extractArray<DashboardData["todayVisits"][number]>(sourceData.todayVisits),
    upcomingVisits: extractArray<DashboardData["upcomingVisits"][number]>(sourceData.upcomingVisits),
    dueReminders: extractArray<DashboardData["dueReminders"][number]>(sourceData.dueReminders),
    inventory: {
      ...(sourceData.inventory && typeof sourceData.inventory === "object" ? sourceData.inventory : {}),
      totalItems: sourceData.inventory?.totalItems ?? 0,
      lowStockCount: sourceData.inventory?.lowStockCount ?? 0,
      lowStock: extractArray<DashboardData["inventory"]["lowStock"][number]>(sourceData.inventory?.lowStock),
      items: extractArray<DashboardData["inventory"]["items"][number]>(sourceData.inventory?.items),
    },
  } : null, [sourceData]);
  const isLoading = !displayData && dashboardLoading;
  const { data: backupStatus, isLoading: backupLoading } = trpc.filters.backup.status.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const backupMutation = trpc.filters.backup.createNow.useMutation();
  const backupUtils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const cashSource = displayData?.cash;
  const inventoryItems = extractArray(displayData?.inventory?.items);
  const counts = {
    today: displayData?.todayVisits.length ?? 0,
    upcoming: displayData?.upcomingVisits.length ?? 0,
    due: displayData?.dueReminders.length ?? 0,
    inventory: inventoryItems.length,
    cash: Math.round(Number(cashSource?.balance ?? 0) || 0),
  };
  const nextVisit = displayData?.upcomingVisits[0];
  const nextDueReminder = displayData?.dueReminders[0];
  const workOrderSummary = displayData?.workOrderSummary;
  function saveLocalSnapshot() {
    if (!displayData) {
      toast.error("لا توجد بيانات متاحة للحفظ المحلي بعد");
      return;
    }
    if (displayData) cacheOfflineDashboard(displayData);
    toast.success("تم حفظ البيانات الحالية على الجهاز بنجاح");
  }
  function downloadDashboardPdf() {
    const rows: Array<Record<string, unknown>> = [];
    displayData?.todayVisits?.forEach(visit => rows.push({ القسم: "زيارات اليوم", العميل: visit.customer?.name || "—", التاريخ: formatDateTime(visit.visitDate), التفاصيل: visitTypeLabels[visit.visitType as keyof typeof visitTypeLabels] || visit.visitType || "—" }));
    displayData?.upcomingVisits?.forEach(visit => rows.push({ القسم: "زيارات قادمة", العميل: visit.customer?.name || "—", التاريخ: formatDateTime(visit.visitDate), التفاصيل: visitTypeLabels[visit.visitType as keyof typeof visitTypeLabels] || visit.visitType || "—" }));
    displayData?.dueReminders?.forEach(reminder => rows.push({ القسم: "متابعات مستحقة", العميل: reminder.customer?.name || "—", التاريخ: formatDateTime(reminder.reminderDate), التفاصيل: `متأخر ${reminder.daysOverdue ?? 0} يوم` }));
    displayData?.inventory?.items?.forEach(item => rows.push({ القسم: "المخزن", العميل: item.name, التاريخ: `رقم ${item.id}`, التفاصيل: `الرصيد ${item.currentBalance} — الحد الأدنى ${item.reorderLevel ?? 2}` }));
    rows.push({ القسم: "الخزينة", العميل: "الرصيد الحالي", التاريخ: "—", التفاصيل: `${Math.round(displayData?.cash?.balance ?? 0)}` });
    const opened = printArabicPdf("تقرير ملخص التطبيق", rows, [
      { key: "القسم", label: "القسم" },
      { key: "العميل", label: "العميل / الصنف" },
      { key: "التاريخ", label: "التاريخ / الرقم" },
      { key: "التفاصيل", label: "التفاصيل" },
    ]);
    if (!opened) toast.error("تعذر فتح نافذة PDF؛ يرجى السماح بالنوافذ المنبثقة ثم المحاولة مرة أخرى.");
  }

  const cardDetails = {
    today: "الزيارات المسجلة لهذا اليوم",
    upcoming: nextVisit ? `${nextVisit.customer?.name || "عميل"} · ${formatDateTime(nextVisit.visitDate)}` : "لا توجد زيارات مسجلة",
    due: nextDueReminder ? `${nextDueReminder.customer?.name || "عميل"} · متأخر ${nextDueReminder.daysOverdue} يوم` : "لا توجد متابعة متأخرة",
    inventory: "عدد الأصناف المسجلة",
    cash: "الرصيد الحالي",
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-[linear-gradient(135deg,#064e4a,#0f766e)] px-6 py-7 text-white shadow-[0_16px_40px_rgba(6,78,74,.22)] sm:flex-row sm:items-center sm:px-8">
        <div>
          <p className="text-sm font-bold text-teal-100">{appSettings.companyName}</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">كل عملياتك في مكان واحد</h1>
          <p className="mt-2 text-sm text-teal-50/80">تابع الزيارات والعملاء والمخزن بسرعة ووضوح.</p>
        </div>
      </section>

      <section className={`soft-card flex flex-col gap-3 border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${online ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/80"}`} role="status" aria-live="polite">
        <div className="flex items-start gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white ${online ? "bg-emerald-600" : "bg-amber-500"}`}>{online ? <CloudUpload className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}</div>
          <div>
            <p className={`font-extrabold ${online ? "text-emerald-900" : "text-amber-900"}`}>{online ? "متصل — البيانات تُحفظ في السيرفر المركزي" : "لا يوجد اتصال بالسيرفر المركزي"}</p>
            <p className={`mt-1 text-xs font-semibold ${online ? "text-emerald-700" : "text-amber-800"}`}>{online ? "المعلومات المشتركة تُحدّث تلقائياً كل ٨ ثوانٍ" : "لا يمكن إنشاء أو تعديل البيانات حتى يعود الاتصال"}</p>
          </div>
        </div>
        <button type="button" onClick={saveLocalSnapshot} className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${online ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`} aria-label="تنزيل نسخة احتياطية محلية">تنزيل نسخة احتياطية</button>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2 id="quick-actions-title" className="text-lg font-extrabold text-teal-950">إجراءات سريعة</h2><p className="mt-1 text-xs font-semibold text-muted-foreground">ابدأ العملية الأساسية من مكان واحد</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => setLocation("/customers/new")} aria-label="تسجيل عميل جديد" className="soft-card group flex min-h-28 items-center gap-3 border border-teal-200 bg-gradient-to-l from-teal-50 to-white p-4 text-right transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(13,82,76,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-700 text-white shadow-lg shadow-teal-900/10"><UserPlus className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-teal-950 sm:text-base">تسجيل عميل جديد</span><span className="mt-1 block text-xs font-semibold text-teal-700">فتح نموذج العميل</span></span>
            <ChevronLeft className="h-5 w-5 shrink-0 text-teal-700 transition group-hover:translate-x-[-2px]" />
          </button>
          <button type="button" onClick={() => setLocation("/customers/visit")} aria-label="تسجيل زيارة جديدة" className="soft-card group flex min-h-28 items-center gap-3 border border-sky-200 bg-gradient-to-l from-sky-50 to-white p-4 text-right transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(14,116,144,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-900/10"><ClipboardList className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-sky-950 sm:text-base">تسجيل زيارة جديدة</span><span className="mt-1 block text-xs font-semibold text-sky-700">فتح نموذج الزيارة</span></span>
            <ChevronLeft className="h-5 w-5 shrink-0 text-sky-700 transition group-hover:translate-x-[-2px]" />
          </button>
          <button type="button" onClick={() => setLocation("/cash?entry=expense")} aria-label="تسجيل مصروف" className="soft-card group flex min-h-28 items-center gap-3 border border-amber-200 bg-gradient-to-l from-amber-50 to-white p-4 text-right transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(180,83,9,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-900/10"><CircleDollarSign className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-amber-950 sm:text-base">تسجيل مصروف</span><span className="mt-1 block text-xs font-semibold text-amber-800">تسجيل حركة مالية</span></span>
            <ChevronLeft className="h-5 w-5 shrink-0 text-amber-700 transition group-hover:translate-x-[-2px]" />
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {statStyles.filter(card => card.key !== "upcoming" || appSettings.dashboardShowUpcoming).filter(card => card.key !== "due" || appSettings.dashboardShowDue).filter(card => card.key !== "cash" || appSettings.dashboardShowCash).filter(card => card.key !== "inventory" || appSettings.dashboardShowInventory).map(({ icon: Icon, color, label, key, href }) => (
          <button
            key={key}
            type="button"
            onClick={() => setLocation(href)}
            aria-label={`فتح تفاصيل ${label}`}
            className="soft-card group flex items-center gap-4 p-5 text-right transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(13,82,76,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            <div className={`grid h-12 w-12 place-items-center rounded-2xl ${color} text-white shadow-lg shadow-black/10`}><Icon className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">{label}</p>
                {key === "inventory" && !isLoading && (displayData?.inventory?.lowStockCount ?? 0) > 0 ? <span data-testid="dashboard-low-stock-badge" role="status" aria-label={`يوجد ${displayData?.inventory?.lowStockCount ?? 0} أصناف منخفضة الرصيد`} className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-sm shadow-rose-900/20"><span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />منخفض {displayData?.inventory?.lowStockCount}</span> : null}
              </div>
              <p className="mt-1 text-2xl font-extrabold">{isLoading ? "—" : counts[key]}</p><p className="mt-1 line-clamp-1 text-[11px] font-semibold text-muted-foreground" title={cardDetails[key]}>{isLoading ? "جارٍ التحميل…" : cardDetails[key]}</p>
            </div>
            <ChevronLeft className="h-5 w-5 text-teal-700 opacity-0 transition group-hover:translate-x-[-2px] group-hover:opacity-100" />
          </button>
        ))}
        <button type="button" onClick={() => setLocation("/settings?section=trash")} className="soft-card group flex min-w-0 items-center gap-3 border border-rose-100 bg-rose-50/70 p-4 text-right transition hover:-translate-y-0.5 hover:border-rose-200 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2" aria-label="فتح سلة المحذوفات">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-900/10"><Trash2 className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-rose-950">سلة المحذوفات</p><p className="mt-1 line-clamp-1 text-[11px] font-semibold text-rose-800">العناصر المحذوفة</p></div>
          <span className="rounded-full bg-white px-2.5 py-1 text-sm font-extrabold text-rose-700 shadow-sm">{trashCount.toLocaleString("ar-SA")}</span>
        </button>
      </section>

      <ReminderAlertBanner />

      <section className="soft-card border border-teal-200/80 bg-gradient-to-l from-teal-50/80 via-white to-sky-50/60 p-5 sm:p-6" aria-labelledby="work-orders-summary-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal-600" aria-hidden="true" /><h2 id="work-orders-summary-title" className="font-extrabold text-teal-950">متابعة أوامر الشغل</h2><span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-extrabold text-teal-800">{isLoading ? "—" : workOrderSummary?.total ?? 0} أمر</span></div>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">ملخص سريع لحالة الأوامر المسندة إلى الفنيين</p>
          </div>
          <Button type="button" onClick={() => setLocation("/work-orders")} variant="outline" className="rounded-xl border-teal-700/25 text-teal-800 hover:bg-teal-100"><ClipboardList className="ml-2 h-4 w-4" />فتح أوامر الفنيين</Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "مسندة", value: workOrderSummary?.assigned ?? 0, tone: "border-sky-200 bg-sky-50 text-sky-800" },
            { label: "قيد التنفيذ", value: workOrderSummary?.inProgress ?? 0, tone: "border-amber-200 bg-amber-50 text-amber-800" },
            { label: "مكتملة", value: workOrderSummary?.completed ?? 0, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
            { label: "لم تُنفذ", value: workOrderSummary?.notCompleted ?? 0, tone: "border-rose-200 bg-rose-50 text-rose-800" },
          ].map(card => <button type="button" key={card.label} onClick={() => setLocation("/work-orders")} className={`rounded-2xl border p-3 text-right transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${card.tone}`} aria-label={`فتح أوامر ${card.label}`}><p className="text-xs font-extrabold">{card.label}</p><p className="mt-1 text-2xl font-black">{isLoading ? "—" : card.value.toLocaleString("ar-SA")}</p></button>)}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <div className="soft-card border border-orange-200 bg-orange-50/35 xl:col-span-3">
          <div className="flex items-center justify-between border-b border-teal-950/6 p-5">
            <div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" aria-hidden="true" /><h2 className="font-extrabold text-orange-950">الزيارات القادمة</h2><span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-extrabold text-sky-700">{displayData?.upcomingVisits.length ?? 0}</span></div><p className="mt-1 text-xs text-muted-foreground">المواعيد المسجلة خلال الأيام الخمسة القادمة</p><p className="mt-1 text-[11px] font-semibold text-sky-700">تظهر من الغد وحتى خمسة أيام قبل الموعد</p></div>
            <div className="flex items-center gap-3"><span title="هذه مواعيد مسجلة خلال خمسة أيام قادمة" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" />خلال ٥ أيام</span><button onClick={() => setLocation("/visits")} className="text-sm font-bold text-teal-700 hover:text-teal-900">عرض الكل</button></div>
          </div>
          <div className="divide-y divide-teal-950/6">
            {displayData?.upcomingVisits.length ? displayData.upcomingVisits.map(visit => {
              const days = daysUntil(visit.visitDate);
              return <button key={visit.id} onClick={() => setLocation(`/customers/${visit.customerId}`)} className="flex w-full items-center justify-between gap-3 p-4 text-right hover:bg-orange-100/55">
                <div className="min-w-0"><p className="truncate font-bold">{visit.customer?.name || "عميل"}</p><p className="mt-1 text-xs text-muted-foreground">{visit.customer?.customerCode ? `${visit.customer.customerCode} · ` : ""}{visitTypeLabels[visit.visitType as keyof typeof visitTypeLabels] || "زيارة"} · {formatDateTime(visit.visitDate)}</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${days <= 0 ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700"}`}>{days === 0 ? "اليوم" : `بعد ${days} يوم`}</span><ChevronLeft className="h-5 w-5 shrink-0 text-teal-600" />
              </button>;
            }) : <EmptyRow text="لا توجد زيارات مسجلة قادمة حاليًا." action="تسجيل زيارة" onAction={() => setLocation("/visits")} />}
          </div>
        </div>

        <div className="soft-card border border-rose-200 bg-rose-50/35 xl:col-span-2">
          <div className="flex items-center justify-between border-b border-teal-950/6 p-5">
            <div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" aria-hidden="true" /><h2 className="font-extrabold text-rose-950">المتابعة المستحقة</h2><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-800">{displayData?.dueReminders.length ?? 0}</span></div><p className="mt-1 text-xs text-muted-foreground">تذكيرات أنشأها التطبيق بعد {appSettings.followUpDays} يومًا من آخر تركيب أو صيانة</p></div>
            <div className="flex items-center gap-2"><span title="هذه القائمة تحتاج إجراء منك: اتصل بالعميل وحدد الزيارة" className="inline-flex items-center gap-1 text-xs font-bold text-amber-700"><Info className="h-3.5 w-3.5" />تحتاج متابعة</span><BellRing className="h-5 w-5 text-amber-500" /></div>
          </div>
          <div className="divide-y divide-teal-950/6">
            {displayData?.dueReminders.length ? displayData.dueReminders.slice(0, 4).map(reminder => (
              <button key={reminder.id} onClick={() => setLocation(`/customers/${reminder.customerId}`)} className="flex w-full items-center justify-between gap-3 p-4 text-right hover:bg-rose-100/55">
                <div className="min-w-0"><p className="truncate font-bold">{reminder.customer?.name || "عميل"}</p><p className="mt-1 text-xs text-amber-700">{reminder.customer?.customerCode ? `${reminder.customer.customerCode} · ` : ""}استحق في {formatDateTime(reminder.reminderDate)} · <strong>متأخر {reminder.daysOverdue} يوم</strong></p><p className="mt-1 text-[11px] font-bold text-teal-700">اضغط لفتح ملف العميل وتسجيل الزيارة</p></div>
                <ChevronLeft className="h-5 w-5 shrink-0 text-amber-600" />
              </button>
             )) : <EmptyRow text="لا توجد متابعة مستحقة الآن." action="عرض كل التذكيرات" onAction={() => setLocation("/reminders")} />}
          </div>
        </div>
      </section>

      <section className="soft-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-teal-950/6 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">حالة المخزن</h2>{!isLoading && (displayData?.inventory?.lowStockCount ?? 0) > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800"><span className="h-1.5 w-1.5 rounded-full bg-rose-600" aria-hidden="true" />تنبيه رصيد منخفض</span> : null}</div><p className="mt-1 text-xs text-muted-foreground">{displayData?.inventory?.lowStockCount ? `${displayData.inventory.lowStockCount} أصناف تحتاج مراجعة الرصيد` : "الأرصدة المتاحة قيد المتابعة"}</p></div>
          <Button variant="outline" onClick={() => setLocation("/inventory")} className="rounded-xl border-teal-700/20 text-teal-800 hover:bg-teal-50"><PackageSearch className="ml-2 h-4 w-4" />إدارة المخزن</Button>
        </div>
        {isLoading ? <EmptyRow text="جارٍ تحميل أسماء الأصناف…" /> : inventoryItems.length ? <div className="p-4 sm:p-5"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-bold text-muted-foreground">الأصناف الموجودة داخل المخزن</p><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-extrabold text-violet-700">{inventoryItems.length} صنف</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{inventoryItems.slice(0, 8).map(item => { const visual = inventoryVisual(undefined, item.name); const Icon = visual.icon; return <button type="button" key={item.id} aria-label={`فتح تفاصيل ${item.name}`} onClick={() => setLocation(`/inventory?item=${item.id}`)} className="flex min-w-0 items-center gap-2 rounded-xl border border-teal-100 bg-white/80 px-2.5 py-2 text-right shadow-sm transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${visual.tone}`}><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-xs font-extrabold text-teal-950" title={item.name}>{item.name}</p><p className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-black ${inventoryBalanceTone(item.currentBalance, item.reorderLevel ?? 2)}`}>الرصيد {item.currentBalance}</p></div></button>; })}{inventoryItems.length > 8 ? <div className="flex items-center justify-center rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">+{inventoryItems.length - 8} أصناف أخرى</div> : null}</div></div> : <EmptyRow text="لا توجد أصناف مسجلة في المخزن." />}
      </section>

      <section className="soft-card overflow-hidden border border-sky-200/70 bg-gradient-to-l from-sky-50/80 to-white">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-600/20"><CloudDownload className="h-5 w-5" /></div>
            <div>
              <h2 className="font-extrabold text-slate-900">النسخة الاحتياطية Excel</h2>
              <p className="mt-1 text-xs leading-6 text-slate-600">تنزيل عربي شامل لكل العملاء والزيارات والتذكيرات والخزينة والمخزن والتعاملات المحلية.</p>
              <p className="mt-1 text-[11px] font-bold text-sky-700">تُنشأ النسخة على هذا الجهاز وتعمل دون إنترنت.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-52 sm:flex-row">
            <input ref={restoreInputRef} type="file" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" className="hidden" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!window.confirm("تحذير: ستستبدل الاستعادة البيانات المحلية الحالية. يفضل تنزيل نسخة حالية أولًا. هل تريد المتابعة؟")) return; try { const result = restoreOfflineBackupFromExcel(await file.arrayBuffer()); toast.success(`تمت استعادة ${result.restoredKeys} عناصر محلية. سيعاد تحميل التطبيق الآن.`); window.setTimeout(() => window.location.reload(), 700); } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر استعادة ملف Excel."); } }} aria-label="اختيار ملف Excel للاستعادة" />
            <button type="button" onClick={() => { const downloaded = downloadOfflineBackup(); toast(downloaded ? `تم تنزيل ملف Excel العربي الشامل (${getOfflineBackupKeyCount()} عناصر محلية).` : "تعذر إنشاء ملف النسخة الاحتياطية."); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-extrabold text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"><Download className="h-4 w-4" />تنزيل Excel</button>
            <button type="button" onClick={downloadDashboardPdf} disabled={!displayData} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-extrabold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"><Printer className="h-4 w-4" />تنزيل PDF</button>
            <button type="button" onClick={() => restoreInputRef.current?.click()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-4 text-sm font-extrabold text-sky-800 transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"><Upload className="h-4 w-4" />استعادة Excel</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function daysUntil(value: Date | string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(value);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
}


function EmptyRow({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return <div className="flex flex-col items-center justify-center gap-3 p-8 text-center"><p className="text-sm text-muted-foreground">{text}</p>{action ? <button onClick={onAction} className="inline-flex items-center text-sm font-bold text-teal-700"><ArrowLeft className="ml-1 h-4 w-4" />{action}</button> : null}</div>;
}
