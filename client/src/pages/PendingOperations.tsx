import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CloudOff, RefreshCw, Server, Wifi } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link } from "wouter";

/**
 * The old offline queue screen is intentionally kept as a compatibility route.
 * Operational records are now written directly to the central API; this page
 * must never present browser storage as pending server data.
 */
export default function PendingOperations() {
  const { user } = useAuth();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const returnPath = user?.role === "user" ? "/technician-preview" : "/";

  return (
    <main dir="rtl" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <section className="mb-6 flex flex-col justify-between gap-4 rounded-3xl bg-teal-800 p-6 text-white shadow-lg sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-bold text-teal-100">المزامنة المركزية</p>
          <h1 className="mt-1 text-2xl font-black">حالة اتصال الأجهزة</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-teal-100">
            جميع العملاء والزيارات وأوامر الشغل تُحفظ مباشرة في قاعدة البيانات المركزية. لا يتم اعتبار أي تعديل محفوظاً قبل نجاح استجابة الخادم.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-bold" role="status" aria-live="polite">
          {online ? <Wifi className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
          {online ? "متصل بالخادم" : "لا يوجد اتصال بالخادم"}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link href="/settings?section=sync" data-testid="connection-settings-card" aria-label="فتح إعدادات الاتصال والمصدر المركزي" className="group block rounded-2xl border border-teal-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 active:scale-[.99]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><Server className="h-5 w-5" /></div>
              <div>
                <h2 className="font-black text-slate-900">المصدر الوحيد للبيانات</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">يقرأ التطبيق البيانات من واجهات API المركزية، وتظهر التحديثات للأجهزة الأخرى بعد إعادة الجلب التلقائي.</p>
              </div>
            </div>
            <ArrowLeft className="mt-1 h-5 w-5 shrink-0 text-teal-700 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
          </div>
          <span className="mt-4 inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-extrabold text-teal-800">اضغط لفتح إعدادات الاتصال</span>
        </Link>
        <Link href="/settings?section=sync" data-testid="sync-settings-card" aria-label="فتح إعدادات المزامنة والتحديث التلقائي" className="group block rounded-2xl border border-sky-100 bg-sky-50/60 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 active:scale-[.99]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-sky-700"><RefreshCw className="h-5 w-5" /></div>
              <div>
                <h2 className="font-black text-slate-900">التحديث التلقائي مفعل</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">تحدّث القوائم المشتركة دورياً كل 8 ثوانٍ، كما تعيد المحاولة تلقائياً عند عودة الاتصال.</p>
              </div>
            </div>
            <ArrowLeft className="mt-1 h-5 w-5 shrink-0 text-sky-700 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
          </div>
          <span className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold text-sky-800">اضغط لفتح إعدادات المزامنة</span>
        </Link>
      </section>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={returnPath}><Button className="gap-2 bg-teal-700 hover:bg-teal-800">العودة إلى {user?.role === "user" ? "أوامر الفني" : "الرئيسية"}</Button></Link>
      </div>
    </main>
  );
}

/** Compatibility helper: there is no local operational queue anymore. */
export function pendingOperationsCountForTest() {
  return 0;
}
