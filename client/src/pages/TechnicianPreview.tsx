import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Clock3, FileText, MapPin, Mic, ShieldCheck, Square, UserRound, Wifi, Wrench } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { CustomerContactActions } from "@/components/CustomerContactActions";
import { UsedItemsSection, type CatalogItem, type UsedVisitItem } from "@/pages/Customers";
import { extractArray } from "@/lib/dataNormalization";
import { normalizeEvidenceDataUrl } from "../../../shared/evidence";
import { printWorkOrderReceipt } from "@/lib/pdfExport";

const statusLabels: Record<string, string> = {
  assigned: "مسند",
  en_route: "في الطريق",
  arrived: "وصل",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  postponed: "مؤجل",
  cancelled: "ملغى",
};

const serviceLabels: Record<string, string> = {
  installation: "تركيب فلتر",
  maintenance: "صيانة",
  cartridge_change: "تغيير شمعات",
  follow_up: "متابعة",
  other: "أخرى",
};

type SelectedItem = UsedVisitItem;
type WorkOrderRow = Record<string, any> & { id: number; status: string };
const MAX_COLLECTION_AMOUNT = 100000;
const resultQuickChoices = ["تم التركيب بنجاح", "تمت الصيانة", "تم تغيير الشمعات", "تم الفحص والمتابعة", "يحتاج قطعة غيار", "يحتاج زيارة متابعة"];
const notCompletedQuickChoices = ["العميل غير موجود", "العميل طلب التأجيل", "تعذر الوصول للموقع", "الموقع مغلق", "تحتاج الزيارة موافقة الإدارة", "سبب آخر"];
const collectionQuickChoices = ["0", "50", "100", "250", "500", "1000"];

async function compressFieldPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.78;
  let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("تعذر تجهيز الصورة");
  while (blob.size >= 200 * 1024 && quality > 0.45) {
    quality -= 0.06;
    blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob) throw new Error("تعذر ضغط الصورة");
  }
  if (blob.size >= 200 * 1024) throw new Error("تعذر ضغط الصورة إلى أقل من 200 كيلوبايت");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة"));
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    reader.readAsDataURL(blob);
  });
}

export default function TechnicianPreview() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [result, setResult] = useState("");
  const [outcome, setOutcome] = useState<"completed" | "not_completed">("completed");
  const [notCompletedReason, setNotCompletedReason] = useState("");
  const [photoBeforeDataUrl, setPhotoBeforeDataUrl] = useState<string | null>(null);
  const [photoAfterDataUrl, setPhotoAfterDataUrl] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; label: string } | null>(null);
  const [photoBeforeName, setPhotoBeforeName] = useState("");
  const [photoAfterName, setPhotoAfterName] = useState("");
  const [tdsIn, setTdsIn] = useState("");
  const [tdsOut, setTdsOut] = useState("");
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [amount, setAmount] = useState("");
  const [collectionState, setCollectionState] = useState<"paid" | "partial" | "unpaid">("paid");
  const [followUpDays, setFollowUpDays] = useState("120");
  const [nextVisitDate, setNextVisitDate] = useState("");
  const [usedItems, setUsedItems] = useState<UsedVisitItem[]>([]);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemQuantity, setManualItemQuantity] = useState("1");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);
  const query = trpc.filters.workOrders.list.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const notificationSettingsQuery = trpc.filters.notifications.settings.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const inventorySummaryQuery = trpc.filters.inventory.technicianSummary.useQuery(undefined, {
    retry: false,
    staleTime: 5_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const utils = trpc.useUtils();
  const addProof = trpc.filters.workOrders.addProof.useMutation({
    onSuccess: () => {
      toast.success("تم إرسال مرفق الزيارة للمتابع");
      void query.refetch();
      void utils.filters.workOrders.list.invalidate();
    },
    onError: error => toast.error(error.message || "تعذر إرسال صورة الزيارة"),
  });
  const update = trpc.filters.workOrders.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ تحديث أمر العمل");
      query.refetch();
      utils.filters.visits.list.invalidate();
      utils.filters.dashboard.invalidate();
    setSelectedId(null);
    setResult("");
      setOutcome("completed");
      setNotCompletedReason("");
      setPhotoBeforeDataUrl(null);
      setPhotoAfterDataUrl(null);
      setPhotoBeforeName("");
      setPhotoAfterName("");
      setTdsIn("");
      setTdsOut("");
      setAudioDataUrl(null);
      setAudioName("");
      setIsRecording(false);
      setAmount("");
      setCollectionState("paid");
      setFollowUpDays("120");
      setNextVisitDate("");
    },
    onError: error => toast.error(error.message || "تعذر حفظ التحديث"),
  });

  const orders = useMemo<WorkOrderRow[]>(() => extractArray<WorkOrderRow>(query.data), [query.data]);
  const visible = useMemo(() => filter === "all" ? orders : orders.filter(order => order.status === filter), [filter, orders]);
  const selected = orders.find(order => order.id === selectedId);
  const catalogItems = useMemo<CatalogItem[]>(() => extractArray<CatalogItem>(inventorySummaryQuery.data), [inventorySummaryQuery.data]);

  useEffect(() => {
    setUsedItems([]);
    setManualItemName("");
    setManualItemQuantity("1");
  }, [selectedId]);

  const addInventoryItem = (item: CatalogItem) => {
    setUsedItems(current => {
      const existing = current.find(entry => entry.inventoryItemId === item.id);
      const requestedQuantity = (existing?.quantity ?? 0) + 1;
      const safeQuantity = item.currentBalance === undefined ? requestedQuantity : Math.min(requestedQuantity, item.currentBalance);
      if (safeQuantity <= (existing?.quantity ?? 0)) return current;
      if (existing) return current.map(entry => entry.inventoryItemId === item.id ? { ...entry, quantity: safeQuantity } : entry);
      return [...current, { inventoryItemId: item.id, quantity: 1, source: "manual" }];
    });
  };

  const addManualInventoryItem = () => {
    const item = catalogItems.find(entry => entry.name.trim().toLocaleLowerCase() === manualItemName.trim().toLocaleLowerCase());
    if (!item) {
      toast.error("اختر صنفًا موجودًا في المخزن.");
      return;
    }
    const quantity = Number.parseInt(manualItemQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error("أدخل كمية صحيحة للصنف.");
      return;
    }
    const selectedQuantity = usedItems.find(entry => entry.inventoryItemId === item.id)?.quantity ?? 0;
    if (item.currentBalance !== undefined && selectedQuantity + quantity > item.currentBalance) {
      toast.error(`الكمية المطلوبة أكبر من رصيد ${item.name} المتاح.`);
      return;
    }
    setUsedItems(current => {
      const existing = current.find(entry => entry.inventoryItemId === item.id);
      if (existing) return current.map(entry => entry.inventoryItemId === item.id ? { ...entry, quantity: entry.quantity + quantity } : entry);
      return [...current, { inventoryItemId: item.id, quantity, source: "manual" }];
    });
    setManualItemName("");
    setManualItemQuantity("1");
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("المتصفح لا يدعم تسجيل الصوت؛ استخدم الكتابة اليدوية.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 10 * 1024 * 1024) {
          toast.error("حجم التسجيل الصوتي أكبر من 10 ميجابايت.");
        } else {
          const reader = new FileReader();
          reader.onload = () => { if (typeof reader.result === "string") { setAudioDataUrl(reader.result); setAudioName("تسجيل صوتي"); } };
          reader.readAsDataURL(blob);
          toast.success("تم تجهيز التسجيل الصوتي");
        }
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      toast.success("بدأ التسجيل؛ اضغط مرة أخرى عند الانتهاء");
    } catch {
      toast.error("تعذر الوصول إلى الميكروفون؛ اسمح بالوصول أو استخدم الكتابة.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const addQuickResult = (choice: string) => {
    setResult(current => current.trim() ? `${current.trim()} — ${choice}` : choice);
  };

  const saveUpdate = (input: { id: number; status: "en_route" | "arrived" | "in_progress" | "completed" | "postponed"; visitResult: string | null; notes: string | null; executionOutcome?: "completed" | "not_completed" | null; notCompletedReason?: string | null; collectedAmount: number; tdsIn?: number | null; tdsOut?: number | null; nextVisitDate?: Date | null; followUpDays?: number | null; items: SelectedItem[] }) => {
    if (!online) {
      toast.error("لا يوجد اتصال بالسيرفر؛ أعد المحاولة بعد عودة الإنترنت.");
      return;
    }
    const beforeDataUrl = photoBeforeDataUrl ? normalizeEvidenceDataUrl(photoBeforeDataUrl) : null;
    const afterDataUrl = photoAfterDataUrl ? normalizeEvidenceDataUrl(photoAfterDataUrl) : null;
    const voiceDataUrl = audioDataUrl ? normalizeEvidenceDataUrl(audioDataUrl) : null;
    if (photoBeforeDataUrl && !beforeDataUrl) { toast.error("صيغة صورة قبل الصيانة غير مدعومة؛ أعد اختيار الصورة."); return; }
    if (photoAfterDataUrl && !afterDataUrl) { toast.error("صيغة صورة بعد الصيانة غير مدعومة؛ أعد اختيار الصورة."); return; }
    if (audioDataUrl && !voiceDataUrl) { toast.error("صيغة التسجيل الصوتي غير مدعومة؛ أعد التسجيل."); return; }
    if (beforeDataUrl) addProof.mutate({ visitId: input.id, kind: "photo", photoSlot: "before", dataUrl: beforeDataUrl });
    if (afterDataUrl) addProof.mutate({ visitId: input.id, kind: "photo", photoSlot: "after", dataUrl: afterDataUrl });
    if (voiceDataUrl) addProof.mutate({ visitId: input.id, kind: "audio", dataUrl: voiceDataUrl });
    update.mutate(input);
  };
  const updateOrder = (id: number, status: "en_route" | "arrived" | "in_progress") => {
    saveUpdate({ id, status, visitResult: null, notes: null, executionOutcome: null, notCompletedReason: null, collectedAmount: 0, items: [] });
  };

  const completeOrder = () => {
    if (!selected) return;
    const normalizedFollowUpDays = followUpDays.trim() ? Number(followUpDays.trim()) : null;
    if (outcome === "completed" && normalizedFollowUpDays !== null && (!Number.isInteger(normalizedFollowUpDays) || normalizedFollowUpDays < 0 || normalizedFollowUpDays > 3650)) {
      toast.error("أدخل عدد أيام متابعة صحيحًا بين 0 و3650 يومًا.");
      return;
    }
    if (outcome === "completed" && nextVisitDate && normalizedFollowUpDays !== null) {
      toast.error("اختر مدة بالأيام أو تاريخًا محددًا، وليس الاثنين معًا.");
      return;
    }
    const normalizedAmount = Number(amount.trim() || "0");
    if (!Number.isFinite(normalizedAmount) || !Number.isInteger(normalizedAmount) || normalizedAmount < 0) {
      toast.error("أدخل مبلغًا صحيحًا غير سالب.");
      return;
    }
    if (normalizedAmount > MAX_COLLECTION_AMOUNT) {
      toast.error("مبلغ التحصيل غير منطقي؛ الحد الأقصى المسموح 100,000.");
      return;
    }

    if (outcome === "not_completed" && !notCompletedReason.trim()) {
      toast.error("اكتب سبب عدم تنفيذ الزيارة قبل الحفظ.");
      return;
    }
    saveUpdate({
      id: selected.id,
      status: outcome === "completed" ? "completed" : "postponed",
      executionOutcome: outcome,
      notCompletedReason: outcome === "not_completed" ? notCompletedReason.trim() : null,
      visitResult: result.trim() || (outcome === "completed" ? "تم تنفيذ الخدمة" : "لم يتم تنفيذ الزيارة"),
      notes: null,
      // المبلغ موحّد كوحدة نقدية كاملة في الواجهة والخادم والخزينة.
      collectedAmount: outcome === "completed" ? normalizedAmount : 0,
      tdsIn: outcome === "completed" && tdsIn.trim() ? Number(tdsIn) : null,
      tdsOut: outcome === "completed" && tdsOut.trim() ? Number(tdsOut) : null,
      nextVisitDate: outcome === "completed" ? (nextVisitDate ? new Date(`${nextVisitDate}T12:00:00`) : null) : undefined,
      followUpDays: outcome === "completed" ? normalizedFollowUpDays : undefined,
      items: outcome === "completed" ? usedItems : [],
    });
  };

  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-xl space-y-3 bg-[#f4faf9] px-3 pb-6 pt-3 sm:px-4">
      <section className="overflow-hidden rounded-[1.5rem] bg-[linear-gradient(135deg,#075e59,#0f766e)] p-4 text-white shadow-lg sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => { void logout(); setLocation("/technician-login"); }} className="grid h-10 w-10 place-items-center rounded-xl bg-white/15" aria-label="تسجيل الخروج"><ArrowLeft className="h-5 w-5" /></button>
          <div className="text-left"><p className="text-xs font-bold text-teal-100">حساب الفني</p><h1 className="mt-1 text-2xl font-black">أوامري فقط</h1></div>
          <Wrench className="h-7 w-7 text-teal-100" />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm"><span className="font-bold">الفني: {user?.name || "حساب الفني"}</span><div className="flex items-center gap-2"><span className="flex items-center gap-1.5 text-teal-50"><Wifi className="h-4 w-4" /> {online ? "متصل ومزامن" : "لا يوجد اتصال بالخادم"}</span><Button type="button" onClick={() => setLocation("/technician-pending-operations")} variant="secondary" size="sm" className="h-8 rounded-lg bg-white text-teal-800 hover:bg-teal-50">العمليات المعلقة</Button></div></div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {[{ key: "all", label: "كل الأوامر", value: orders.length }, { key: "in_progress", label: "قيد التنفيذ", value: orders.filter(order => ["en_route", "arrived", "in_progress"].includes(order.status)).length }, { key: "completed", label: "مكتملة", value: orders.filter(order => order.status === "completed").length }].map(stat => <button key={stat.key} type="button" onClick={() => setFilter(stat.key)} className={`rounded-xl border bg-white p-2.5 text-center shadow-sm ${filter === stat.key ? "border-teal-500 ring-2 ring-teal-100" : "border-slate-200"}`}><p className="text-[11px] font-bold text-slate-500">{stat.label}</p><p className="mt-1 text-2xl font-black text-teal-800">{stat.value}</p></button>)}
      </section>

      <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3.5"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-black text-emerald-950">أوامرك المسندة فقط</h2><p className="mt-1 text-xs font-semibold leading-6 text-emerald-800">تظهر هنا أوامر العمل الخاصة بك فقط، دون الخزينة أو التقارير أو بيانات باقي الفنيين.</p></div></div></section>

      <section className="space-y-2.5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black text-slate-900">أوامر الشغل</h2><p className="mt-1 text-xs font-bold text-slate-500">حدّث الحالة بعد كل خطوة</p></div><span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-black text-teal-800">{visible.length} أوامر</span></div>
        {visible.length ? visible.map(order => <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"><div className="flex items-start gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><UserRound className="h-6 w-6" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h3 className="truncate text-base font-black text-slate-900">{order.customer?.name || "عميل"}</h3><p className="mt-1 text-xs font-bold text-slate-500">{serviceLabels[order.visitType] || order.visitType}</p></div><span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">{statusLabels[order.status] || order.status}</span></div><div className="mt-3 space-y-2 text-xs font-bold text-slate-500"><span className="flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-teal-600" />{new Date(order.visitDate).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</span><span className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{order.customer?.address || "العنوان غير مسجل"}</span></div></div></div><div className="mt-4 flex flex-wrap items-center gap-2"><CustomerContactActions customer={order.customer ?? {}} serviceType={order.visitType} companyWhatsAppPhone={notificationSettingsQuery.data?.companyWhatsAppPhone} compact labels showLocationPlaceholder hideLocationActions className="shrink-0" />{order.status === "assigned" ? <Button type="button" onClick={() => updateOrder(order.id, "en_route")} className="h-10 rounded-xl bg-teal-700 text-xs font-black">في الطريق</Button> : order.status !== "completed" && order.status !== "cancelled" ? <Button type="button" onClick={() => { setSelectedId(order.id); setResult(order.visitResult || ""); setOutcome(order.executionOutcome === "not_completed" ? "not_completed" : "completed"); setNotCompletedReason(order.notCompletedReason || ""); setPhotoBeforeDataUrl(null); setPhotoAfterDataUrl(null); setPhotoBeforeName(""); setPhotoAfterName(""); setTdsIn(""); setTdsOut(""); setAudioDataUrl(null); setAudioName(""); setIsRecording(false); setCollectionState("paid"); setFollowUpDays("120"); setNextVisitDate(""); }} aria-label="تحديث" className="h-10 rounded-xl bg-teal-700 text-xs font-black">تحديث / تسجيل التنفيذ</Button> : <div className="flex flex-wrap items-center gap-2"><span className="flex h-10 items-center justify-center rounded-xl bg-emerald-50 px-3 text-xs font-black text-emerald-800">تم الحفظ</span><Button type="button" variant="outline" onClick={() => { const opened = printWorkOrderReceipt({ workOrderId: order.id, customerName: order.customer?.name || "", customerPhone: order.customer?.phone, customerAddress: order.customer?.address, visitType: serviceLabels[order.visitType] || order.visitType || "", visitDate: order.visitDate, technicianName: order.technicianName || user?.name, tdsIn: order.tdsIn == null ? null : Number(order.tdsIn), tdsOut: order.tdsOut == null ? null : Number(order.tdsOut), collectedAmount: order.collectedAmount == null ? null : Number(order.collectedAmount), currency: order.collectedCurrency || "SAR", visitResult: order.visitResult, notes: order.notes, items: Array.isArray(order.items) ? order.items.map((item: any) => ({ name: item.name || item.itemName || "", quantity: Number(item.quantity || 0), unit: item.unit })) : [] }); if (opened) toast.success("تم تجهيز فاتورة أمر العمل للطباعة أو الحفظ PDF"); else toast.error("تعذر فتح الفاتورة؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); }} className="h-10 rounded-xl px-3 text-xs font-black text-sky-700"><FileText className="ml-1 h-4 w-4" />فاتورة PDF</Button></div>}</div>{order.status === "en_route" ? <Button type="button" onClick={() => updateOrder(order.id, "arrived")} className="mt-2 h-10 w-full rounded-xl bg-sky-700 text-xs font-black">وصلت إلى العميل</Button> : null}{order.status === "arrived" ? <Button type="button" onClick={() => updateOrder(order.id, "in_progress")} className="mt-2 h-10 w-full rounded-xl bg-indigo-700 text-xs font-black">بدء التنفيذ</Button> : null}</article>) : <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500">لا توجد أوامر مسندة حاليًا.</div>}
      </section>

      {selected ? (
        <section className="rounded-3xl border border-teal-200 bg-white p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-teal-700">إغلاق أمر العمل</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">{selected.customer?.name}</h2>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="text-sm font-black text-slate-500">إغلاق</button>
          </div>
          <div className="mt-4">
            <p className="text-sm font-black text-slate-700">نتيجة الزيارة</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOutcome("completed")} className={`rounded-xl border p-3 text-sm font-black ${outcome === "completed" ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100" : "border-slate-200 bg-white text-slate-600"}`}>تم التنفيذ</button>
              <button type="button" onClick={() => setOutcome("not_completed")} className={`rounded-xl border p-3 text-sm font-black ${outcome === "not_completed" ? "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-100" : "border-slate-200 bg-white text-slate-600"}`}>لم يتم التنفيذ</button>
            </div>
            {outcome === "not_completed" ? <><div className="mt-3"><p className="text-sm font-black text-amber-900">اختر سبب عدم التنفيذ</p><div className="mt-2 flex flex-wrap gap-2">{notCompletedQuickChoices.map(choice => <button key={choice} type="button" onClick={() => setNotCompletedReason(choice)} className={`rounded-full border px-3 py-2 text-xs font-black ${notCompletedReason === choice ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 bg-white text-amber-800"}`}>{choice}</button>)}</div></div><label className="mt-3 block text-sm font-black text-amber-900">تفاصيل إضافية<textarea aria-label="سبب عدم التنفيذ" value={notCompletedReason} onChange={event => setNotCompletedReason(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-amber-200 bg-amber-50/40 p-3 font-bold" placeholder="اختر سببًا أو اكتب تفاصيل إضافية" /></label></> : null}<div className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="صور توثيق العمل"><label className="group block rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/60 p-3 text-sm font-black text-amber-950 shadow-sm"><span className="mb-1 block text-base font-black text-amber-950">صورة قبل الصيانة</span><input aria-label="صورة قبل الصيانة" type="file" accept="image/jpg,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { setPhotoBeforeDataUrl(await compressFieldPhoto(file)); setPhotoBeforeName(file.name); toast.success("تم ضغط صورة قبل الصيانة وتجهيزها"); } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر ضغط الصورة"); } }} className="mt-2 block w-full rounded-xl border border-slate-200 bg-white p-2 text-xs font-bold" /><span className="mt-1 block text-[11px] font-bold text-slate-500">{photoBeforeName || "أقل من 200KB تلقائيًا"}</span>{photoBeforeDataUrl ? <img src={photoBeforeDataUrl} alt="معاينة قبل الصيانة - اضغط للتكبير" role="button" tabIndex={0} onClick={() => setLightboxImage({ url: photoBeforeDataUrl, label: "صورة قبل الصيانة" })} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setLightboxImage({ url: photoBeforeDataUrl, label: "صورة قبل الصيانة" }); } }} className="mt-3 h-44 w-full cursor-zoom-in rounded-xl border border-slate-200 bg-white object-cover shadow-sm outline-none ring-teal-500 focus-visible:ring-2" /> : null}</label><label className="group block rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/60 p-3 text-sm font-black text-emerald-950 shadow-sm"><span className="mb-1 block text-base font-black text-emerald-950">صورة بعد الصيانة</span><input aria-label="صورة بعد الصيانة" type="file" accept="image/jpg,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { setPhotoAfterDataUrl(await compressFieldPhoto(file)); setPhotoAfterName(file.name); toast.success("تم ضغط صورة بعد الصيانة وتجهيزها"); } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر ضغط الصورة"); } }} className="mt-2 block w-full rounded-xl border border-slate-200 bg-white p-2 text-xs font-bold" /><span className="mt-1 block text-[11px] font-bold text-slate-500">{photoAfterName || "أقل من 200KB تلقائيًا"}</span>{photoAfterDataUrl ? <img src={photoAfterDataUrl} alt="معاينة بعد الصيانة - اضغط للتكبير" role="button" tabIndex={0} onClick={() => setLightboxImage({ url: photoAfterDataUrl, label: "صورة بعد الصيانة" })} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setLightboxImage({ url: photoAfterDataUrl, label: "صورة بعد الصيانة" }); } }} className="mt-3 h-44 w-full cursor-zoom-in rounded-xl border border-slate-200 bg-white object-cover shadow-sm outline-none ring-emerald-500 focus-visible:ring-2" /> : null}</label></div>
          </div>
          <div className="mt-4"><p className="text-sm font-black text-slate-700">اختر ما تم تنفيذه</p><div className="mt-2 flex flex-wrap gap-2">{resultQuickChoices.map(choice => <button key={choice} type="button" onClick={() => addQuickResult(choice)} className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-black text-teal-800">{choice}</button>)}</div></div>
          <label className="mt-3 block text-sm font-black text-slate-700">ملاحظات إضافية<textarea aria-label="ما تم تنفيذه" value={result} onChange={event => setResult(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 p-3 font-bold" placeholder="اكتب تفاصيل إضافية أو استخدم التسجيل الصوتي" /></label>
          <div className="mt-3 rounded-2xl border border-teal-100 bg-teal-50/60 p-3">
            <div className="flex items-center justify-between gap-2"><div><p className="text-sm font-black text-teal-950">ملاحظة صوتية اختيارية</p><p className="mt-1 text-[11px] font-bold text-teal-800">يمكنك الكتابة أو التسجيل أو استخدام الاثنين معًا.</p></div><button type="button" onClick={isRecording ? stopRecording : startRecording} className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white ${isRecording ? "bg-rose-600" : "bg-teal-700"}`} aria-label={isRecording ? "إيقاف التسجيل" : "بدء التسجيل"}>{isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button></div>
            {isRecording ? <p className="mt-2 text-xs font-black text-rose-700">جاري التسجيل… اضغط الزر لإيقافه.</p> : null}
            {audioDataUrl ? <div className="mt-3 flex items-center gap-2"><audio controls src={audioDataUrl} className="h-10 min-w-0 flex-1" /><button type="button" onClick={() => { setAudioDataUrl(null); setAudioName(""); }} className="rounded-lg px-2 py-1 text-xs font-black text-rose-700">حذف</button><span className="sr-only">{audioName}</span></div> : null}
          </div>
          <div className="mt-3"><p className="text-sm font-black text-slate-700">حالة التحصيل</p><div className="mt-2 grid grid-cols-3 gap-2"><button type="button" onClick={() => setCollectionState("paid")} className={`rounded-xl border p-2 text-xs font-black ${collectionState === "paid" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}>تم التحصيل</button><button type="button" onClick={() => setCollectionState("partial")} className={`rounded-xl border p-2 text-xs font-black ${collectionState === "partial" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>جزء من المبلغ</button><button type="button" onClick={() => { setCollectionState("unpaid"); setAmount("0"); }} className={`rounded-xl border p-2 text-xs font-black ${collectionState === "unpaid" ? "border-rose-500 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-600"}`}>لم يتم التحصيل</button></div></div>
          <label className="mt-3 block text-sm font-black text-slate-700">المبلغ المحصل<input aria-label="المبلغ المحصل" inputMode="numeric" min="0" max={MAX_COLLECTION_AMOUNT} value={amount} onChange={event => { setCollectionState("partial"); setAmount(event.target.value.replace(/[^0-9-]/g, "")); }} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-lg font-black" placeholder="0" /><div className="mt-2 flex flex-wrap gap-2">{collectionQuickChoices.map(choice => <button key={choice} type="button" onClick={() => { setCollectionState(choice === "0" ? "unpaid" : "partial"); setAmount(choice); }} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700">{choice}</button>)}</div><span className="mt-1 block text-[11px] font-bold text-slate-500">اختر مبلغًا سريعًا أو اكتب الرقم كما هو</span></label>
          <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-sm font-black text-slate-700">TDS قبل الصيانة<input aria-label="TDS قبل الصيانة" inputMode="numeric" value={tdsIn} onChange={event => setTdsIn(event.target.value.replace(/[^0-9]/g, ""))} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-lg font-black" placeholder="اختياري" /></label><label className="text-sm font-black text-slate-700">TDS بعد الصيانة<input aria-label="TDS بعد الصيانة" inputMode="numeric" value={tdsOut} onChange={event => setTdsOut(event.target.value.replace(/[^0-9]/g, ""))} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-lg font-black" placeholder="اختياري" /></label></div>
          {outcome === "completed" ? <section className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/70 p-3" aria-label="موعد المتابعة القادمة"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-black text-sky-950">موعد الزيارة القادمة</p><p className="mt-1 text-[11px] font-bold text-sky-800">اترك 120 يومًا تلقائيًا أو غيّرها لهذا العميل فقط.</p></div><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" /></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-black text-sky-950">عدد أيام المتابعة<input aria-label="عدد أيام المتابعة للفني" inputMode="numeric" min="0" max="3650" value={followUpDays} onChange={event => { setFollowUpDays(event.target.value.replace(/[^0-9]/g, "")); setNextVisitDate(""); }} className="mt-1.5 h-11 w-full rounded-xl border border-sky-200 bg-white px-3 text-base font-black" placeholder="120" /></label><label className="text-xs font-black text-sky-950">أو تاريخ محدد<input aria-label="تاريخ المتابعة القادمة للفني" type="date" value={nextVisitDate} onChange={event => { setNextVisitDate(event.target.value); setFollowUpDays(""); }} className="mt-1.5 h-11 w-full rounded-xl border border-sky-200 bg-white px-3 text-base font-black" /></label></div><button type="button" onClick={() => { setFollowUpDays(""); setNextVisitDate(""); }} className="mt-2 rounded-lg px-2 py-1 text-xs font-black text-sky-800 underline underline-offset-2">بدون موعد</button><p className="mt-1 text-[11px] font-bold text-sky-800">{nextVisitDate ? `سيُحفظ الموعد المحدد: ${new Date(`${nextVisitDate}T12:00:00`).toLocaleDateString("ar-EG")}` : followUpDays ? `سيُحسب تلقائيًا بعد ${followUpDays} يومًا من إغلاق الزيارة.` : "لن يتم إنشاء موعد متابعة لهذا الإغلاق."}</p></section> : null}
          {outcome === "completed" ? <UsedItemsSection items={usedItems} setItems={setUsedItems} catalogItems={catalogItems} manualName={manualItemName} setManualName={setManualItemName} manualQuantity={manualItemQuantity} setManualQuantity={setManualItemQuantity} onAdd={addManualInventoryItem} onQuickAdd={addInventoryItem} listId="technician-inventory-items" /> : null}
          <Button type="button" onClick={completeOrder} disabled={update.isPending} className="mt-4 h-12 w-full rounded-xl bg-teal-700 font-black hover:bg-teal-800">{update.isPending ? "جاري الحفظ..." : <><CheckCircle2 className="ml-2 h-5 w-5" /> حفظ وإغلاق أمر العمل</>}</Button>
        </section>
      ) : null}
      {lightboxImage ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label={lightboxImage.label} onClick={() => setLightboxImage(null)}><div className="relative flex max-h-[92vh] max-w-5xl flex-col items-center gap-3" onClick={event => event.stopPropagation()}><button type="button" onClick={() => setLightboxImage(null)} aria-label="إغلاق الصورة المكبرة" className="self-end rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-lg">إغلاق</button><img src={lightboxImage.url} alt={lightboxImage.label} className="max-h-[78vh] max-w-full rounded-2xl bg-white object-contain shadow-2xl" /><p className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-900">{lightboxImage.label}</p></div></div> : null}
    </main>
  );
}
