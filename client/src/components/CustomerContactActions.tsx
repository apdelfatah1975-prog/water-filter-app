import React, { type ReactNode, useState } from "react";
import { customerMapUrl, buildWhatsAppUrl, labelVisitType } from "@/lib/filterUi";
import { MapPinned, MessageCircle, Phone, X } from "lucide-react";

type CustomerContact = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  location?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

type WhatsAppStage = "on_the_way" | "arrived" | "completed";

const whatsappStages: Array<{ value: WhatsAppStage; label: string; message: string }> = [
  { value: "on_the_way", label: "في الطريق إليك", message: "أبلغكم أن الفني في طريقه إليكم الآن." },
  { value: "arrived", label: "وصلت للموقع", message: "أبلغكم أن الفني وصل إلى موقعكم ويمكنه بدء الخدمة." },
  { value: "completed", label: "تم الانتهاء من الصيانة", message: "تم الانتهاء من خدمة الصيانة، ونشكركم على ثقتكم بنا." },
];

function buildWorkOrderWhatsAppMessage(customerName: string, serviceType: string | null | undefined, stage: WhatsAppStage, companyWhatsAppPhone?: string | null) {
  const status = whatsappStages.find(item => item.value === stage)?.message ?? "يسعدنا خدمتكم.";
  const service = labelVisitType(serviceType) || "الخدمة المطلوبة";
  const companyContact = companyWhatsAppPhone?.trim() ? `للتواصل مع الشركة: ${companyWhatsAppPhone.trim()}` : "شركة نقطة نقاء";
  return `مرحبًا ${customerName}،\n${status}\nنوع الخدمة: ${service}\n${companyContact}`;
}

export function CustomerContactActions({
  customer,
  serviceType,
  companyWhatsAppPhone,
  compact = false,
  labels = false,
  showLocationPlaceholder = false,
  hideLocationActions = false,
  className = "",
}: {
  customer: CustomerContact;
  serviceType?: string | null;
  companyWhatsAppPhone?: string | null;
  compact?: boolean;
  labels?: boolean;
  showLocationPlaceholder?: boolean;
  hideLocationActions?: boolean;
  className?: string;
}) {
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const phone = customer.phone?.trim() || null;
  const mapUrl = customerMapUrl(customer);
  const customerName = customer.name?.trim() || "عميلنا العزيز";
  const locationRequestUrl = phone ? buildWhatsAppUrl(phone, `مرحبًا ${customerName}، نرجو إرسال موقعكم الجغرافي لتسهيل وصول الفني.`) : null;
  const locationShareUrl = phone && mapUrl ? buildWhatsAppUrl(phone, `مرحبًا ${customerName}، هذا هو موقعكم المسجل لدى الشركة لتسهيل الوصول: ${mapUrl}`) : null;
  const sizeClass = compact ? (labels ? "min-h-10 px-3" : "h-10 w-10") : "h-11 px-3";
  const iconClass = compact && !labels ? "h-4 w-4 shrink-0" : "ml-1.5 h-4 w-4 shrink-0";
  const baseClass = `inline-flex items-center justify-center rounded-xl font-bold transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${sizeClass}`;
  const content = (icon: ReactNode, text: string) => <>{icon}{labels ? text : null}</>;

  const openWhatsApp = (stage: WhatsAppStage) => {
    const message = buildWorkOrderWhatsAppMessage(customer.name?.trim() || "عميلنا العزيز", serviceType, stage, companyWhatsAppPhone);
    const url = buildWhatsAppUrl(phone, message);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    setWhatsappOpen(false);
  };

  return <>
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`} aria-label="إجراءات التواصل مع العميل">
      {phone ? <a href={`tel:${phone}`} className={`${baseClass} bg-teal-50 text-teal-800`} title="اتصال بالعميل" aria-label="اتصال بالعميل">{content(<Phone className={iconClass} />, "اتصال")}</a> : <span className={`${baseClass} cursor-not-allowed bg-slate-100 text-slate-400`} title="رقم هاتف العميل غير مسجل" aria-label="رقم هاتف العميل غير مسجل">{content(<Phone className={iconClass} />, "بدون هاتف")}</span>}
      {phone ? <button type="button" onClick={() => setWhatsappOpen(true)} className={`${baseClass} bg-emerald-50 text-emerald-800`} title="اختيار رسالة واتساب للعميل" aria-label="إرسال رسالة واتساب للعميل">{content(<MessageCircle className={iconClass} />, "واتساب")}</button> : null}
      {mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className={`${baseClass} bg-indigo-50 text-indigo-800`} title="فتح موقع العميل على خرائط Google" aria-label="فتح موقع العميل على خرائط Google">{content(<MapPinned className={iconClass} aria-hidden="true" />, "الموقع")}</a> : showLocationPlaceholder ? <span className={`${baseClass} cursor-not-allowed bg-slate-100 text-slate-400`} title="لم يتم تسجيل موقع أو عنوان العميل" aria-label="موقع العميل غير مسجل">{content(<MapPinned className={iconClass} aria-hidden="true" />, "الموقع غير مسجل")}</span> : null}
      {labels && !hideLocationActions && locationShareUrl ? <a href={locationShareUrl} target="_blank" rel="noreferrer" className={`${baseClass} bg-cyan-50 text-cyan-800`} title="مشاركة موقع العميل عبر واتساب" aria-label={`مشاركة موقع ${customerName} عبر واتساب`}>{content(<MapPinned className={iconClass} aria-hidden="true" />, "مشاركة الموقع")}</a> : null}
      {labels && !hideLocationActions && locationRequestUrl ? <a href={locationRequestUrl} target="_blank" rel="noreferrer" className={`${baseClass} bg-sky-50 text-sky-800`} title="طلب موقع العميل عبر واتساب" aria-label="طلب موقع العميل عبر واتساب">{content(<MapPinned className={iconClass} aria-hidden="true" />, "طلب الموقع")}</a> : null}
    </div>
    {whatsappOpen ? <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" role="presentation" onClick={() => setWhatsappOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="whatsapp-stage-title" className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" dir="rtl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-emerald-700">واتساب العميل</p><h2 id="whatsapp-stage-title" className="mt-1 text-lg font-black text-slate-950">اختر حالة الزيارة</h2><p className="mt-1 text-xs font-bold text-slate-500">سيتم فتح المحادثة والنص جاهزًا للإرسال.</p></div><button type="button" onClick={() => setWhatsappOpen(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="إغلاق"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 grid gap-2">{whatsappStages.map(stage => <button key={stage.value} type="button" onClick={() => openWhatsApp(stage.value)} className="min-h-12 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 text-right font-black text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{stage.label}</button>)}</div>
      </section>
    </div> : null}
  </>;
}
