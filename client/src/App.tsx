import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "./_core/hooks/useAuth";
import type { ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
const CustomerProfile = lazy(() => import("./pages/CustomerProfile"));
const Customers = lazy(() => import("./pages/Customers"));
const Cash = lazy(() => import("./pages/Cash"));
const Home = lazy(() => import("./pages/Home"));
const Inventory = lazy(() => import("./pages/Inventory"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Reminders = lazy(() => import("./pages/Reminders"));
const Reports = lazy(() => import("./pages/Reports"));
const TechnicianPayroll = lazy(() => import("./pages/TechnicianPayroll"));
const Settings = lazy(() => import("./pages/Settings"));
const Visits = lazy(() => import("./pages/Visits"));
const TechnicianPreview = lazy(() => import("./pages/TechnicianPreview"));
const TechnicianLogin = lazy(() => import("./pages/TechnicianLogin"));
const TechnicianLocations = lazy(() => import("./pages/TechnicianLocations"));
const AllowedTechnicians = lazy(() => import("./pages/AllowedTechnicians"));
const WorkOrders = lazy(() => import("./pages/WorkOrders"));
const PublicDemo = lazy(() => import("./pages/PublicDemo"));
const PendingOperations = lazy(() => import("./pages/PendingOperations"));

function AdminOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role !== "admin") {
    return (
      <section className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-6 py-16 text-center" dir="rtl">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl">!</div>
          <h1 className="text-xl font-black text-amber-950">لا يمكن الوصول إلى هذا القسم</h1>
          <p className="mt-2 text-sm leading-7 text-amber-900/75">هذا القسم مخصص للإدارة فقط. يمكنك متابعة العملاء والزيارات والتذكيرات من القوائم المتاحة لك.</p>
        </div>
      </section>
    );
  }
  return <>{children}</>;
}

function TechnicianPwaHead() {
  useEffect(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previousHref = manifest?.getAttribute("href") ?? "/manifest.webmanifest";
    const previousTitle = document.title;
    if (manifest) {
      manifest.href = window.location.pathname.startsWith("/technician-app")
        ? "/technician-app/technician-manifest.webmanifest"
        : "/technician-manifest.webmanifest";
    }
    document.title = "أوامر الفني | نقطة نقاء";
    return () => {
      if (manifest) manifest.href = previousHref;
      document.title = previousTitle;
    };
  }, []);
  return null;
}

function TechnicianOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: false });
  if (loading) {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6 py-16 text-center" dir="rtl">
        <div className="rounded-3xl border border-teal-100 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-teal-100" />
          <p className="font-bold text-slate-800">جارٍ التحقق من حساب الفني…</p>
          <p className="mt-2 text-sm text-slate-500">هذه الصفحة لا تعمل إلا بعد تسجيل الدخول بحساب فني مصرح.</p>
        </div>
      </section>
    );
  }
  if (!user) return <TechnicianLogin />;
  if (user.role !== "user") {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6 py-16 text-center" dir="rtl">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <h1 className="text-xl font-black text-amber-950">الحساب غير مصرح له بواجهة الفني</h1>
          <p className="mt-2 text-sm leading-7 text-amber-900/75">استخدم حساب الفني المخصص لك أو ارجع إلى لوحة الإدارة.</p>
        </div>
      </section>
    );
  }
  return <><TechnicianPwaHead />{children}</>;
}

function ProtectedTechnician() { return <TechnicianOnly><TechnicianPreview /></TechnicianOnly>; }
function TechnicianPendingOperations() { return <TechnicianOnly><PendingOperations /></TechnicianOnly>; }
function AdminInventory() { return <AdminOnly><Inventory /></AdminOnly>; }
function AdminCash() { return <AdminOnly><Cash /></AdminOnly>; }
function AdminReports() { return <AdminOnly><Reports /></AdminOnly>; }
function AdminTechnicianPayroll() { return <AdminOnly><TechnicianPayroll /></AdminOnly>; }
function AdminTechnicianLocations() { return <AdminOnly><TechnicianLocations /></AdminOnly>; }
function AdminAllowedTechnicians() { return <AdminOnly><AllowedTechnicians /></AdminOnly>; }
function AdminPendingOperations() { return <AdminOnly><PendingOperations /></AdminOnly>; }

function LocalPageBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
function SafeHome() { return <LocalPageBoundary><Home /></LocalPageBoundary>; }
function SafeCustomers() { return <LocalPageBoundary><Customers /></LocalPageBoundary>; }
function SafeVisits() { return <LocalPageBoundary><Visits /></LocalPageBoundary>; }
function SafeWorkOrders() { return <LocalPageBoundary><AdminOnly><WorkOrders /></AdminOnly></LocalPageBoundary>; }

function Router() {
  const [location] = useLocation();
  const pathname = typeof window !== "undefined" ? window.location.pathname : location;
  if (pathname.replace(/\/$/, "") === "/demo") return <PublicDemo />;
  const cleanPath = pathname.replace(/\/$/, "");
  if (cleanPath === "/technician-app/login") return <TechnicianLogin />;
  if (cleanPath === "/technician-app") return <ProtectedTechnician />;
  if (cleanPath === "/technician-login") return <TechnicianLogin />;
  if (cleanPath === "/technician-preview") return <ProtectedTechnician />;
  if (cleanPath === "/technician-pending-operations") return <TechnicianPendingOperations />;
  if (pathname.replace(/\/$/, "") === "/work-orders") return <DashboardLayout><SafeWorkOrders /></DashboardLayout>;
  if (pathname.replace(/\/$/, "") === "/technician-locations") return <DashboardLayout><AdminTechnicianLocations /></DashboardLayout>;
  if (pathname.replace(/\/$/, "") === "/allowed-technicians") return <DashboardLayout><AdminAllowedTechnicians /></DashboardLayout>;
  if (pathname.replace(/\/$/, "") === "/pending-operations") return <DashboardLayout><AdminPendingOperations /></DashboardLayout>;
  return (
    <Suspense fallback={<section className="mx-auto flex min-h-[40vh] max-w-xl items-center justify-center px-6 py-16 text-center" dir="rtl"><div className="rounded-2xl border border-teal-100 bg-white px-6 py-5 shadow-sm"><div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-teal-100" /><p className="font-bold text-slate-800">جارٍ فتح الصفحة…</p></div></section>}>
      <DashboardLayout>
      <Switch>
        <Route path="/" component={SafeHome} />
        <Route path="/customers/new" component={SafeCustomers} />
        <Route path="/customers/visit" component={SafeCustomers} />
        <Route path="/customers/:id" component={CustomerProfile} />
        <Route path="/customers" component={SafeCustomers} />
        <Route path="/visits" component={SafeVisits} />
        <Route path="/reminders" component={Reminders} />
        <Route path="/inventory" component={AdminInventory} />
        <Route path="/cash" component={AdminCash} />
        <Route path="/reports" component={AdminReports} />
        <Route path="/technician-payroll" component={AdminTechnicianPayroll} />
        <Route path="/technician-locations" component={AdminTechnicianLocations} />
        <Route path="/allowed-technicians" component={AdminAllowedTechnicians} />
        <Route path="/pending-operations" component={AdminPendingOperations} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
      </DashboardLayout>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-center" />
          <Suspense fallback={<section className="mx-auto flex min-h-screen items-center justify-center px-6 py-16 text-center" dir="rtl"><div className="rounded-2xl border border-teal-100 bg-white px-6 py-5 shadow-sm"><div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-teal-100" /><p className="font-bold text-slate-800">جارٍ فتح التطبيق…</p></div></section>}>
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
