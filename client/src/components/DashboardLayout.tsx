import { useAuth } from "@/_core/hooks/useAuth";
import React from "react";
import { useIsFetching } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { trpc } from "@/lib/trpc";
import { BackupDialog } from "@/components/BackupDialog";
import { useIsMobile } from "@/hooks/useMobile";
import {
  BellRing,
  ClipboardList,
  ClipboardCheck,
  CalendarPlus,
  CircleDollarSign,
  FileBarChart,
  WalletCards,
  Droplets,
  Sparkles,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  Settings,
  UsersRound,
  MapPinned,
  UserRoundPlus,
  RefreshCw,
  FileDown,
  Printer,
  Timer,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { printCurrentPage } from "@/lib/print";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { AutomaticReminderNotifications } from "./AutomaticReminderNotifications";
import { InstallAppButton } from "./InstallAppButton";
import { countPendingReminders, countPendingWorkOrders } from "@/lib/notificationBadges";
import { formatLastRefreshTime, getAutoRefreshSettings, isEditingFormElement, setAutoRefreshSettings, type AutoRefreshIntervalMinutes } from "@/lib/autoRefresh";
import { getBackupSuccessCopy } from "@/lib/backupFeedback";
import { getAppSettings, type AppFontSize, type AppSettings } from "@/lib/appSettings";

const menuItems = [
  { icon: LayoutDashboard, label: "الرئيسية", path: "/" },
  { icon: UsersRound, label: "العملاء", path: "/customers" },
  { icon: CalendarPlus, label: "سجل الزيارات", path: "/visits" },
  { icon: ClipboardList, label: "أوامر الفنيين", path: "/work-orders" },
  { icon: BellRing, label: "التذكيرات", path: "/reminders" },
  { icon: PackageSearch, label: "المخزن", path: "/inventory" },
  { icon: CircleDollarSign, label: "الخزينة والمصروفات", path: "/cash" },
  { icon: FileBarChart, label: "التقارير", path: "/reports" },
  { icon: WalletCards, label: "كشف رواتب الفنيين", path: "/technician-payroll" },
  { icon: MapPinned, label: "خريطة الفنيين", path: "/technician-locations" },
  { icon: UserRoundPlus, label: "الحسابات المسموح بها", path: "/allowed-technicians" },
  { icon: ClipboardCheck, label: "حالة المزامنة", path: "/pending-operations" },
  { icon: Settings, label: "الإعدادات", path: "/settings" },
];

const mobileNavItems = [
  menuItems.find(item => item.path === "/")!,
  menuItems.find(item => item.path === "/customers")!,
  menuItems.find(item => item.path === "/visits")!,
  menuItems.find(item => item.path === "/work-orders")!,
  menuItems.find(item => item.path === "/cash")!,
  menuItems.find(item => item.path === "/reports")!,
  menuItems.find(item => item.path === "/inventory")!,
  menuItems.find(item => item.path === "/reminders")!,
  menuItems.find(item => item.path === "/technician-payroll")!,
  menuItems.find(item => item.path === "/technician-locations")!,
  menuItems.find(item => item.path === "/allowed-technicians")!,
  menuItems.find(item => item.path === "/pending-operations")!,
  menuItems.find(item => item.path === "/settings")!,
];

function isAppFontSize(value: unknown): value is AppFontSize {
  return value === "small" || value === "medium" || value === "large";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();
  const [fontSize, setFontSize] = React.useState<AppFontSize>(() => getAppSettings().fontSize);

  React.useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<Partial<AppSettings>>).detail?.fontSize;
      if (isAppFontSize(next)) setFontSize(next);
    };
    window.addEventListener("purepoint-settings-changed", handleSettingsChange);
    return () => window.removeEventListener("purepoint-settings-changed", handleSettingsChange);
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    return () => {
      delete document.documentElement.dataset.fontSize;
    };
  }, [fontSize]);

  React.useEffect(() => {
    if (!loading && user && user.role !== "admin" && window.location.pathname !== "/technician-app") setLocation("/technician-app");
  }, [loading, user, setLocation]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (user && user.role !== "admin" && window.location.pathname !== "/technician-app") {
    return (
      <section className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-center" dir="rtl">
        <div className="max-w-sm rounded-3xl border border-teal-100 bg-white p-7 shadow-sm">
          <Droplets className="mx-auto h-10 w-10 text-teal-700" />
          <h1 className="mt-4 text-xl font-black text-slate-900">جارٍ فتح أوامر العمل</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">حساب الفني مخصص لأوامر العمل فقط.</p>
        </div>
      </section>
    );
  }

  if (!user) return <LocalLoginScreen />;

  return (
    <SidebarProvider defaultOpen={true} dir="rtl" className="min-w-0 max-w-full overflow-x-hidden">
      <DashboardLayoutContent fontSize={fontSize}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function LocalLoginScreen() {
  const utils = trpc.useUtils();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [isRegister, setIsRegister] = React.useState(false);
  const login = trpc.auth.login.useMutation({
    onSuccess: data => {
      utils.auth.me.setData(undefined, data.user);
      toast.success("تم تسجيل الدخول بنجاح");
    },
    onError: error => toast.error(error.message || "تعذر تسجيل الدخول"),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: data => { utils.auth.me.setData(undefined, data.user); toast.success("تم إنشاء الحساب وتسجيل الدخول"); },
    onError: error => toast.error(error.message || "تعذر إنشاء الحساب"),
  });
  const pending = login.isPending || register.isPending;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top,#dff6f2,transparent_48%),#f6fbfa] px-3 py-4 sm:p-5" dir="rtl">
      <div className="w-full max-w-md rounded-[1.5rem] border border-emerald-100 bg-card p-5 shadow-[0_24px_80px_rgba(15,118,110,.14)] sm:rounded-[2rem] sm:p-10">
        <div className="relative mx-auto mb-5 grid h-20 w-20 place-items-center rounded-[1.5rem] bg-gradient-to-br from-cyan-400 via-teal-600 to-emerald-700 pb-1 text-white shadow-lg shadow-teal-700/25 ring-4 ring-cyan-100 transition duration-200 ease-out hover:brightness-110 sm:mb-7 sm:h-24 sm:w-24 sm:rounded-[2rem]">
          <Droplets className="relative z-10 mt-[-8px] h-10 w-10 drop-shadow-sm" />
          <span className="absolute bottom-2 z-10 text-[11px] font-black tracking-tight text-white">نقطة نقاء</span>
          <span className="absolute h-2.5 w-2.5 rounded-full bg-gradient-to-br from-amber-200 to-orange-400 shadow-sm ring-1 ring-white/80" aria-hidden="true" />
        </div>
        <h1 className="text-center text-xl font-extrabold tracking-tight sm:text-2xl">{isRegister ? "إنشاء أول حساب" : "تسجيل الدخول"}</h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-6 text-muted-foreground">{isRegister ? "سيصبح أول حساب مسجل حساب المدير الرئيسي." : "أدخل بيانات الحساب المحلي للوصول إلى نظام نقطة نقاء."}</p>
        <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); isRegister ? register.mutate({ name, email, password }) : login.mutate({ email, password }); }}>
          {isRegister ? <div className="space-y-2"><Label htmlFor="local-name">اسم المستخدم</Label><Input id="local-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} /></div> : null}
          <div className="space-y-2"><Label htmlFor="local-email">البريد الإلكتروني</Label><Input id="local-email" type="email" dir="ltr" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="local-password">كلمة المرور</Label><Input id="local-password" type="password" dir="ltr" autoComplete={isRegister ? "new-password" : "current-password"} minLength={8} value={password} onChange={event => setPassword(event.target.value)} required /></div>
          <Button type="submit" disabled={pending} size="lg" className="h-12 w-full rounded-xl bg-teal-700 text-base hover:bg-teal-800">{pending ? "جارٍ المعالجة…" : isRegister ? "إنشاء حساب المدير" : "دخول آمن"}</Button>
        </form>
        <button type="button" className="mt-4 text-sm font-bold text-teal-700 hover:underline" onClick={() => setIsRegister(value => !value)}>{isRegister ? "لديك حساب؟ تسجيل الدخول" : "إنشاء أول حساب مدير"}</button>
        <div className="mt-3 flex justify-center"><InstallAppButton /></div>
      </div>
    </div>
  );
}

function DashboardLayoutContent({ children, fontSize }: { children: React.ReactNode; fontSize: AppFontSize }) {
  const { user, loading, logout } = useAuth();
  const technicianPermissions = trpc.filters.allowedTechnicians.myPermissions.useQuery(undefined, { enabled: Boolean(user && user.role !== "admin"), retry: false, staleTime: 60_000 });
  const fetchingCount = useIsFetching();
  const utils = trpc.useUtils();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [autoRefreshSettings, setAutoRefreshSettingsState] = React.useState(getAutoRefreshSettings);
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = React.useState<number | null>(null);
  const [autoRefreshPausedForForm, setAutoRefreshPausedForForm] = React.useState(false);
  const autoRefreshPausedRef = React.useRef(false);
  const visibleMenuItems = user?.role === "admin"
    ? menuItems
    : menuItems.filter(item => {
      const permissions = technicianPermissions.data?.menuPermissions ?? ["workOrders"];
      if (["/", "/inventory", "/cash", "/reports", "/technician-payroll", "/technician-locations", "/allowed-technicians", "/settings"].includes(item.path)) return false;
      if (item.path === "/work-orders" || item.path === "/technician-preview") return permissions.includes("workOrders");
      if (item.path === "/pending-operations") return permissions.includes("pendingOperations");
      if (item.path === "/customers") return permissions.includes("customers");
      if (item.path === "/visits") return permissions.includes("visits");
      return false;
    });
  const [location, setLocation] = useLocation();
  const [isBackupOpen, setIsBackupOpen] = React.useState(false);
  const { state, toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const dueReminders = trpc.filters.reminders.due.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60_000, refetchIntervalInBackground: true });
  const workOrders = trpc.filters.workOrders.list.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60_000, refetchIntervalInBackground: true });
  const createBackup = trpc.filters.backup.createNow.useMutation({
    onSuccess: data => {
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      const feedback = getBackupSuccessCopy({
        downloaded: Boolean(data.downloadUrl),
        customers: data.counts.customers,
        visits: data.counts.visits,
      });
      toast.success(feedback.title, { description: feedback.description });
    },
    onError: error => toast.error(error.message || "تعذر إنشاء النسخة الاحتياطية"),
  });
  const notificationCountFor = (path: string) => {
    if (path === "/reminders") return countPendingReminders(dueReminders.data);
    if (path === "/work-orders") return countPendingWorkOrders(workOrders.data);
    return 0;
  };
  const activeMenuItem = menuItems.find(item => item.path === location)
    ?? (location.startsWith("/customers/") ? menuItems[1] : undefined)
    ?? menuItems[0];
  const initials = user?.name?.trim().slice(0, 1) || "م";
  const pageAccent = location === "/customers"
    ? { bar: "from-sky-500 via-cyan-500 to-teal-500", label: "text-sky-800", surface: "bg-sky-50/95", glow: "shadow-[0_8px_28px_rgba(14,165,233,.18)]" }
    : location === "/inventory"
      ? { bar: "from-amber-400 via-orange-500 to-rose-500", label: "text-orange-800", surface: "bg-amber-50/95", glow: "shadow-[0_8px_28px_rgba(245,158,11,.20)]" }
      : location === "/cash"
        ? { bar: "from-emerald-400 via-teal-500 to-cyan-500", label: "text-emerald-800", surface: "bg-emerald-50/95", glow: "shadow-[0_8px_28px_rgba(16,185,129,.20)]" }
        : location === "/reports"
          ? { bar: "from-violet-500 via-fuchsia-500 to-pink-500", label: "text-violet-800", surface: "bg-violet-50/95", glow: "shadow-[0_8px_28px_rgba(139,92,246,.20)]" }
          : location === "/technician-payroll"
            ? { bar: "from-indigo-500 via-blue-500 to-cyan-500", label: "text-indigo-800", surface: "bg-indigo-50/95", glow: "shadow-[0_8px_28px_rgba(99,102,241,.20)]" }
            : { bar: "from-teal-500 via-cyan-500 to-sky-500", label: "text-teal-800", surface: "bg-teal-50/95", glow: "shadow-[0_8px_28px_rgba(20,184,166,.16)]" };

  const refreshData = React.useCallback(async (source: "manual" | "automatic" = "manual") => {
    if (isRefreshing || (source === "automatic" && autoRefreshPausedRef.current)) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        utils.filters.dashboard.invalidate(),
        utils.filters.customers.list.invalidate(),
        utils.filters.customers.get.invalidate(),
        utils.filters.reminders.due.invalidate(),
        utils.filters.reminders.alerts.invalidate(),
        utils.filters.inventory.summary.invalidate(),
        utils.filters.cash.summary.invalidate(),
        utils.filters.notifications.nextAlert.invalidate(),
      ]);
      if (source === "automatic") setLastAutoRefreshAt(Date.now());
      toast.success(source === "automatic" ? "تم تحديث البيانات تلقائيًا" : "تم تحديث البيانات المحفوظة");
    } catch {
      toast.error("تعذر تحديث البيانات. ستظل البيانات المحفوظة كما هي.");
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, utils]);

  React.useEffect(() => {
    let resumeTimer: number | undefined;
    const updateFormPause = () => {
      const focused = document.activeElement;
      const shouldPause = isEditingFormElement(focused);
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        const current = document.activeElement;
        const stillEditing = isEditingFormElement(current);
        autoRefreshPausedRef.current = stillEditing;
        setAutoRefreshPausedForForm(stillEditing);
      }, shouldPause ? 0 : 1200);
    };
    document.addEventListener("focusin", updateFormPause, true);
    document.addEventListener("focusout", updateFormPause, true);
    return () => {
      window.clearTimeout(resumeTimer);
      document.removeEventListener("focusin", updateFormPause, true);
      document.removeEventListener("focusout", updateFormPause, true);
    };
  }, []);

  React.useEffect(() => {
    if (!autoRefreshSettings.enabled) return;
    const intervalMs = autoRefreshSettings.intervalMinutes * 60 * 1000;
    const timer = window.setInterval(() => { void refreshData("automatic"); }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshSettings.enabled, autoRefreshSettings.intervalMinutes, refreshData]);

  function updateAutoRefresh(next: Partial<typeof autoRefreshSettings>) {
    const saved = setAutoRefreshSettings({ ...autoRefreshSettings, ...next });
    setAutoRefreshSettingsState(saved);
    if (saved.enabled) toast.success(`تم تفعيل التحديث التلقائي كل ${saved.intervalMinutes} دقيقة`);
    else toast.success("تم إيقاف التحديث التلقائي");
  }

  return (
    <>
      <AutomaticReminderNotifications />
      {fetchingCount > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-teal-200 bg-white/95 px-4 py-2 text-xs font-extrabold text-teal-800 shadow-lg shadow-teal-900/10 backdrop-blur"
          dir="rtl"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>جارٍ تحميل البيانات…</span>
        </div>
      ) : null}
      <Sidebar side="right" collapsible="icon" className="border-l border-teal-950/8 bg-[#063c3a] text-white">
        <SidebarHeader className="h-24 border-b border-white/10 px-3 py-4">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
            <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cyan-200 via-teal-100 to-amber-100 pb-0.5 text-teal-800 shadow-lg shadow-black/15 ring-1 ring-cyan-100/90 transition duration-200 ease-out hover:from-cyan-100 hover:via-teal-50 hover:to-amber-200 hover:brightness-110 hover:shadow-[0_0_22px_rgba(45,212,191,.45)]">
              <span className="absolute inset-1 rounded-xl border border-white/80" aria-hidden="true" />
              <Droplets className="relative z-10 mt-[-4px] h-6 w-6 drop-shadow-sm" strokeWidth={2.3} />
              <span className="absolute bottom-1 z-10 text-[7px] font-black leading-none tracking-tight text-teal-900">نقطة نقاء</span>
              <span className="absolute h-1.5 w-1.5 rounded-full bg-gradient-to-br from-amber-200 to-orange-400 shadow-sm ring-1 ring-white/90" aria-hidden="true" />
              <Sparkles className="absolute -right-1 -top-1 z-20 h-3.5 w-3.5 text-amber-300 drop-shadow-sm" strokeWidth={2.4} aria-hidden="true" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="font-extrabold leading-5">إدارة فلاتر المياه</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-3 py-5">
          <p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-teal-100/55 group-data-[collapsible=icon]:hidden">الإدارة</p>
          <SidebarMenu className="gap-1">
            {visibleMenuItems.map(item => {
              const isActive = activeMenuItem.path === item.path;
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => setLocation(item.path)}
                    tooltip={item.label}
                    className="h-11 rounded-xl px-3 text-teal-50 hover:bg-white/10 hover:text-white data-[active=true]:bg-white data-[active=true]:text-teal-900 data-[active=true]:shadow-sm"
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="font-semibold">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t border-white/10 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-xl p-2 text-right transition-colors hover:bg-white/10 group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-9 w-9 shrink-0 border border-white/20">
                  <AvatarFallback className="bg-teal-500 text-xs font-bold text-white">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-bold">{user?.name || "مدير النظام"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-teal-100/65">{user?.role === "admin" ? "حساب الإدارة" : "حساب فني"}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="ml-2 h-4 w-4" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 max-w-full bg-[#f6fbfa]">
        <div className="no-print" aria-live="polite" />
        <header className={`no-print relative sticky top-0 z-20 flex min-h-14 items-center justify-between gap-1.5 border-b border-teal-950/5 px-2 py-2 backdrop-blur-lg sm:h-16 sm:gap-2 sm:px-4 sm:py-0 lg:px-8 ${pageAccent.surface} ${pageAccent.glow}`}>
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-l ${pageAccent.bar}`} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
            {isMobile ? <SidebarTrigger className="h-9 w-9 shrink-0 rounded-xl border border-teal-950/10 bg-white text-teal-800 sm:h-10 sm:w-10"><Menu className="h-5 w-5" /></SidebarTrigger> : null}
            <div>
              <p className={`truncate text-xs font-bold leading-5 sm:text-sm sm:leading-6 ${pageAccent.label}`}>نظام الإدارة</p>
              <h2 className="truncate text-sm font-extrabold leading-6 text-foreground sm:text-base sm:leading-7">{activeMenuItem.label}</h2>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={printCurrentPage}
              aria-label="طباعة الصفحة أو حفظها PDF"
              title="طباعة الصفحة أو حفظها بصيغة PDF"
              className="flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-2.5 text-violet-800 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:shadow-md active:scale-[.98] sm:h-11 sm:min-w-11 sm:px-3"
            >
              <Printer className="h-5 w-5 shrink-0" />
              <span className="hidden whitespace-nowrap text-xs font-extrabold sm:inline">طباعة / PDF</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshData()}
              disabled={isRefreshing}
              aria-label="تحديث البيانات المحفوظة"
              title="تحديث البيانات المحفوظة"
              className="grid h-9 w-9 place-items-center rounded-xl border border-teal-950/8 bg-white text-teal-800 transition hover:bg-teal-50 disabled:cursor-wait disabled:opacity-60 sm:h-11 sm:w-11"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsBackupOpen(true)}
              disabled={createBackup.isPending}
              aria-label="تنزيل نسخة احتياطية بصيغة Excel"
              title="تنزيل نسخة احتياطية Excel"
              className="flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-2.5 text-emerald-800 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-md active:scale-[.98] disabled:cursor-wait disabled:opacity-60 sm:h-11 sm:min-w-11 sm:px-3"
            >
              <FileDown className={`h-5 w-5 shrink-0 ${createBackup.isPending ? "animate-pulse" : ""}`} />
              <span className="hidden whitespace-nowrap text-xs font-extrabold sm:inline">{createBackup.isPending ? "جارٍ التجهيز…" : "نسخة Excel"}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="إعدادات التحديث التلقائي" title="إعدادات التحديث التلقائي" className={`grid h-9 w-9 place-items-center rounded-xl border border-teal-950/8 bg-white transition hover:bg-teal-50 sm:h-11 sm:w-11 ${autoRefreshSettings.enabled ? "text-teal-800" : "text-slate-500"}`}>
                  <Timer className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>التحديث التلقائي</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={autoRefreshSettings.enabled} onCheckedChange={checked => updateAutoRefresh({ enabled: checked === true })}>
                  تفعيل التحديث التلقائي
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">الفترة</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(autoRefreshSettings.intervalMinutes)} onValueChange={value => updateAutoRefresh({ intervalMinutes: Number(value) as AutoRefreshIntervalMinutes })}>
                  <DropdownMenuRadioItem value="5">كل 5 دقائق</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="15">كل 15 دقيقة</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">{autoRefreshPausedForForm ? "موقوف مؤقتًا أثناء إدخال البيانات" : autoRefreshSettings.enabled ? `مفعّل — ${formatLastRefreshTime(lastAutoRefreshAt)}` : "متوقف — فعّله من هنا"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <InstallAppButton compact={isMobile} />
            {!isMobile ? (
              <button onClick={toggleSidebar} className="grid h-10 w-10 place-items-center rounded-xl border border-teal-950/8 bg-white text-teal-800 transition hover:bg-teal-50" aria-label="طي القائمة الجانبية">
                <Menu className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </header>
        <main data-font-size={fontSize} className="min-h-[calc(100dvh-3.5rem)] min-w-0 overflow-x-hidden px-2.5 pb-28 pt-3 sm:min-h-[calc(100vh-4rem)] sm:px-6 sm:pb-28 sm:pt-6 lg:px-8 lg:pb-8 lg:pt-8">{children}</main>
      </SidebarInset>
      {isMobile ? <nav data-print-hide="true" aria-label="التنقل السريع" className="fixed inset-x-0 bottom-0 z-40 min-h-[5.75rem] border-t border-teal-950/10 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(13,82,76,.10)] backdrop-blur-lg">
        <div className="mx-auto flex h-full max-w-full gap-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:thin]">
          {mobileNavItems.map(item => { const active = activeMenuItem.path === item.path; const notificationCount = notificationCountFor(item.path); return <button key={item.path} type="button" onClick={() => setLocation(item.path)} className={`relative flex min-h-[4.5rem] min-w-[78px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold leading-4 transition active:scale-95 ${active ? "bg-teal-700 text-white shadow-md ring-2 ring-teal-200/80" : "text-slate-500 hover:bg-slate-50 hover:text-teal-700"}`} aria-current={active ? "page" : undefined}><span className="relative"><item.icon className="h-5 w-5" />{notificationCount > 0 ? <span className={`absolute -right-3 -top-3 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white px-1 text-[10px] font-black leading-none shadow-sm ${active ? "bg-rose-500 text-white" : "bg-rose-600 text-white"}`} aria-label={`${notificationCount} عناصر معلقة`} title={`${notificationCount} عناصر معلقة`}>{notificationCount > 99 ? "99+" : notificationCount}</span> : null}</span><span className="max-w-[76px] text-center">{item.label}</span></button>; })}
        </div>
      </nav> : null}
      <BackupDialog open={isBackupOpen} onOpenChange={setIsBackupOpen} />
    </>

  );
}
