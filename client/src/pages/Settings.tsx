import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AppSettings, defaultAppSettings, getAppSettings, resetAppSettings, saveAppSettings } from "@/lib/appSettings";
import { Eye, EyeOff, Image as ImageIcon, KeyRound, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Smile, Trash2, Undo2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { appendActivityLog, clearActivityLog, getActivityLog, type ActivityLogEntry } from "@/lib/activityLog";
import { emptyTrash, filterTrashItems, getTrashItems, permanentlyDeleteFromTrash, restoreFromTrash, moveToTrash, type TrashItem } from "@/lib/trashBin";
import { PinVerificationDialog } from "@/components/PinVerificationDialog";

const visitTypes = [
  ["installation", "تركيب فلتر"],
  ["maintenance", "صيانة"],
  ["cartridge_change", "تغيير شمعات"],
  ["follow_up", "متابعة"],
  ["other", "أخرى"],
] as const;

const inventoryEmojiOptions = ["💧", "🧊", "🧴", "🔧", "🧽", "🧪", "📦", "⚙️", "🛠️", "✨"];
type ItemAppearanceDraft = { emoji: string; imageDataUrl?: string; previewUrl?: string; clearImage?: boolean };

function resizeInventoryImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("اختر ملف صورة صالحًا."));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("حجم الصورة الأصلي كبير جدًا؛ اختر صورة أقل من 8 ميجابايت."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("تعذر فتح الصورة."));
      image.onload = () => {
        const maxSide = 640;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold"><span>{label}</span><input type="checkbox" className="h-5 w-5 accent-teal-700" checked={checked} onChange={event => onChange(event.target.checked)} /></label>;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [technicianNameDraft, setTechnicianNameDraft] = useState("");
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>(() => getActivityLog());
  const [trashItems, setTrashItems] = useState<TrashItem[]>(() => getTrashItems());
  const [trashSearch, setTrashSearch] = useState("");
  const [trashType, setTrashType] = useState<"all" | TrashItem["entityType"]>("all");
  const filteredTrashItems = useMemo(() => filterTrashItems(trashItems, trashSearch, trashType), [trashItems, trashSearch, trashType]);
  const trashSectionRef = useRef<HTMLElement | null>(null);
  const restoreCustomer = trpc.filters.customers.create.useMutation();
  const restoreVisit = trpc.filters.visits.create.useMutation();
  const restoreCash = trpc.filters.cash.create.useMutation();
  const restoreInventoryItem = trpc.filters.inventory.createItem.useMutation();
  const restoreInventoryMovement = trpc.filters.inventory.createMovement.useMutation();
  const inventoryQuery = trpc.filters.inventory.summary.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [appearanceDrafts, setAppearanceDrafts] = useState<Record<number, ItemAppearanceDraft>>({});
  const updateAppearance = trpc.filters.inventory.updateAppearance.useMutation({
    onSuccess: () => { inventoryQuery.refetch(); toast.success("تم حفظ مظهر الصنف"); },
    onError: error => toast.error(error.message || "تعذر حفظ مظهر الصنف."),
  });
  const setPin = trpc.filters.notifications.setPin.useMutation({
    onSuccess: () => { setCurrentPin(""); setNewPin(""); setConfirmPin(""); toast.success("تم تغيير الرقم السري بنجاح"); },
    onError: error => toast.error(error.message || "تعذر تغيير الرقم السري."),
  });
  const verifyPin = trpc.filters.notifications.verifyPin.useMutation();
  const utils = trpc.useUtils();
  const seedPerformanceCustomers = trpc.filters.customers.seedPerformanceCustomers.useMutation({
    onSuccess: result => { utils.filters.customers.list.invalidate(); utils.filters.dashboard.invalidate(); toast.success(result.created ? `تم إنشاء ${result.created} عميل تجريبي لاختبار الأداء` : `البيانات التجريبية موجودة بالفعل (${result.existing} عميل)`); },
    onError: error => toast.error(error.message || "تعذر إنشاء البيانات التجريبية."),
  });
  const deletePerformanceCustomers = trpc.filters.customers.deletePerformanceCustomers.useMutation({
    onSuccess: result => { utils.filters.customers.list.invalidate(); utils.filters.dashboard.invalidate(); toast.success(`تم حذف ${result.deleted} عميل تجريبي`); },
    onError: error => toast.error(error.message || "تعذر حذف العملاء التجريبيين."),
  });
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [performanceElapsedSeconds, setPerformanceElapsedSeconds] = useState(0);
  const deleteAllCustomers = trpc.filters.customers.deleteAll.useMutation({
    onSuccess: result => {
      setBulkDeleteOpen(false);
      toast.success(`تم حذف ${result.deletedCustomers} عميلًا و${result.deletedVisits} زيارة وتذكيراته المرتبطة`);
    },
    onError: error => toast.error(error.message || "تعذر حذف جميع العملاء."),
  });
  const [wipeAllOpen, setWipeAllOpen] = useState(false);
  const wipeAllData = trpc.filters.customers.deleteAllData.useMutation({
    onSuccess: result => {
      setWipeAllOpen(false);
      void utils.filters.invalidate();
      const total = Object.values(result.deleted).reduce((sum, value) => sum + value, 0);
      toast.success(`تم مسح كل بيانات التطبيق بنجاح (${total} سجلًا)`);
    },
    onError: error => toast.error(error.message || "تعذر مسح كل بيانات التطبيق."),
  });

  useEffect(() => {
    const pending = seedPerformanceCustomers.isPending || deletePerformanceCustomers.isPending;
    if (!pending) {
      setPerformanceElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setPerformanceElapsedSeconds(0);
    const timer = window.setInterval(() => setPerformanceElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [seedPerformanceCustomers.isPending, deletePerformanceCustomers.isPending]);

  useEffect(() => {
    if (!inventoryQuery.data?.items) return;
    setAppearanceDrafts(current => {
      const next = { ...current };
      let changed = false;
      for (const item of inventoryQuery.data.items) {
        if (!next[item.id]) {
          next[item.id] = { emoji: item.customEmoji ?? "" };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [inventoryQuery.data?.items]);

  useEffect(() => {
    let scrollTimer: number | undefined;
    if (new URLSearchParams(window.location.search).get("section") === "trash") {
      scrollTimer = window.setTimeout(() => trashSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" }), 80);
    }
    const onChange = (event: Event) => setSettings((event as CustomEvent<AppSettings>).detail);
    const onLogChange = () => setActivityLog(getActivityLog());
    const onTrashChange = () => setTrashItems(getTrashItems());
    window.addEventListener("purepoint-activity-log-changed", onLogChange);
    window.addEventListener("purepoint-trash-bin-changed", onTrashChange);
    window.addEventListener("purepoint-settings-changed", onChange);
    return () => {
      if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
      window.removeEventListener("purepoint-settings-changed", onChange);
      window.removeEventListener("purepoint-activity-log-changed", onLogChange);
      window.removeEventListener("purepoint-trash-bin-changed", onTrashChange);
    };
  }, []);

  function updateAppearanceDraft(itemId: number, patch: Partial<ItemAppearanceDraft>) {
    setAppearanceDrafts(current => ({ ...current, [itemId]: { ...(current[itemId] ?? { emoji: "" }), ...patch } }));
  }

  async function chooseItemImage(itemId: number, file: File | undefined) {
    if (!file) return;
    try {
      const imageDataUrl = await resizeInventoryImage(file);
      updateAppearanceDraft(itemId, { imageDataUrl, previewUrl: imageDataUrl, clearImage: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تجهيز الصورة.");
    }
  }

  function saveItemAppearance(item: { id: number; customEmoji?: string | null }) {
    const draft = appearanceDrafts[item.id] ?? { emoji: item.customEmoji ?? "" };
    updateAppearance.mutate({ inventoryItemId: item.id, customEmoji: draft.emoji.trim() || null, imageDataUrl: draft.imageDataUrl ?? null, clearImage: Boolean(draft.clearImage) });
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(current => ({ ...current, [key]: value }));
  }

  function saveAll() {
    const next = saveAppSettings(settings);
    setSettings(next);
    appendActivityLog("تحديث الإعدادات", "تم حفظ إعدادات التطبيق والخيارات المحلية");
    setActivityLog(getActivityLog());
    setSavedAt(new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }));
    toast.success("تم حفظ تفضيلات هذا الجهاز وتطبيقها فورًا");
  }

  function restoreDefaults() {
    if (settings.confirmDestructiveActions && !window.confirm("سيتم إعادة جميع إعدادات التطبيق إلى القيم الافتراضية. هل تريد المتابعة؟")) return;
    setSettings(resetAppSettings());
    setSavedAt(new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }));
    toast.success("تمت إعادة الإعدادات الافتراضية");
  }

  function addTechnician() {
    const name = technicianNameDraft.trim();
    if (!name) { toast.error("اكتب اسم الفني أولًا."); return; }
    if (settings.technicianPayroll[name]) { toast.error("هذا الفني مضاف بالفعل."); return; }
    update("technicianPayroll", { ...settings.technicianPayroll, [name]: { monthlySalary: 0, installationPercent: 0, maintenancePercent: 0 } });
    setTechnicianNameDraft("");
  }

  function updateTechnician(name: string, field: "monthlySalary" | "installationPercent" | "maintenancePercent", value: number) {
    const profile = settings.technicianPayroll[name] ?? { monthlySalary: 0, installationPercent: 0, maintenancePercent: 0 };
    update("technicianPayroll", { ...settings.technicianPayroll, [name]: { ...profile, [field]: Math.max(0, Math.min(field === "monthlySalary" ? 99999999 : 100, value || 0)) } });
  }

  function removeTechnician(name: string) {
    if (settings.confirmDestructiveActions && !window.confirm(`نقل إعدادات الفني ${name} إلى سلة المحذوفات؟`)) return;
    const profile = settings.technicianPayroll[name];
    if (!profile) return;
    moveToTrash({ entityType: "technician-settings", entityLabel: `إعدادات الفني: ${name}`, payload: { name, profile } });
    const next = { ...settings.technicianPayroll };
    delete next[name];
    update("technicianPayroll", next);
    appendActivityLog("نقل إلى سلة المحذوفات", `إعدادات الفني ${name}`);
    setActivityLog(getActivityLog());
    toast.success("نُقلت إعدادات الفني إلى سلة المحذوفات");
  }

  async function restoreTrashItem(item: TrashItem) {
    if (settings.confirmDestructiveActions && !window.confirm(`استعادة ${item.entityLabel}؟`)) return;
    try {
      if (item.entityType === "technician-settings" && item.payload && typeof item.payload === "object" && "name" in item.payload && "profile" in item.payload) {
        const payload = item.payload as { name: string; profile: AppSettings["technicianPayroll"][string] };
        if (settings.technicianPayroll[payload.name]) { toast.error("يوجد فني بنفس الاسم حاليًا؛ احذف التعارض أو غيّر الاسم أولًا."); return; }
        update("technicianPayroll", { ...settings.technicianPayroll, [payload.name]: payload.profile });
      } else if (item.entityType === "customer") {
        const payload = item.payload as { name: string; phone: string; address?: string | null; latitude?: string | null; longitude?: string | null; notes?: string | null; manualCode?: string | null };
        await restoreCustomer.mutateAsync({ name: payload.name, phone: payload.phone, address: payload.address ?? null, latitude: payload.latitude ?? null, longitude: payload.longitude ?? null, notes: payload.notes ?? null, manualCode: payload.manualCode ?? undefined });
      } else if (item.entityType === "visit") {
        const payload = item.payload as { customerId: number; visitType: "installation" | "maintenance" | "cartridge_change" | "follow_up" | "other"; visitDate: string; technicianName?: string | null; notes?: string | null; collectedAmount?: number };
        await restoreVisit.mutateAsync({ customerId: payload.customerId, visitType: payload.visitType, visitDate: new Date(payload.visitDate), technicianName: payload.technicianName ?? null, notes: payload.notes ?? null, collectedAmount: payload.collectedAmount ?? 0, collectedCurrency: "SAR" });
      } else if (item.entityType === "cash") {
        const payload = item.payload as { transactionType: "income" | "expense"; amount: number; category: string; transactionDate: string; recipientName?: string | null; notes?: string | null };
        await restoreCash.mutateAsync({ transactionType: payload.transactionType, amount: payload.amount, category: payload.category, transactionDate: new Date(payload.transactionDate), recipientName: payload.recipientName ?? null, notes: payload.notes ?? null, currency: "SAR" });
      } else if (item.entityType === "inventory") {
        const payload = item.payload as { kind: "item" | "movement"; target: any; relatedMovements?: any[] };
        if (payload.kind === "item") {
          const created = await restoreInventoryItem.mutateAsync({ name: payload.target.name, openingQuantity: payload.target.openingQuantity ?? 0, notes: payload.target.notes ?? null });
          for (const movement of payload.relatedMovements ?? []) await restoreInventoryMovement.mutateAsync({ inventoryItemId: created.id, movementType: movement.movementType, quantity: movement.quantity, unitCost: movement.unitCost ?? 0, currency: "SAR", movementDate: new Date(movement.movementDate), technicianName: movement.technicianName ?? null, notes: movement.notes ?? null });
        } else {
          await restoreInventoryMovement.mutateAsync({ inventoryItemId: payload.target.inventoryItemId, movementType: payload.target.movementType, quantity: payload.target.quantity, unitCost: payload.target.unitCost ?? 0, currency: "SAR", movementDate: new Date(payload.target.movementDate), technicianName: payload.target.technicianName ?? null, notes: payload.target.notes ?? null });
        }
      }
      restoreFromTrash(item.id);
      appendActivityLog("استعادة من سلة المحذوفات", item.entityLabel);
      setActivityLog(getActivityLog());
      toast.success("تمت استعادة العنصر بنجاح");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذرت الاستعادة؛ بقي العنصر في السلة.");
    }
  }

  function permanentlyDeleteTrashItem(item: TrashItem) {
    if (!window.confirm(`حذف ${item.entityLabel} نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    permanentlyDeleteFromTrash(item.id);
    appendActivityLog("حذف نهائي", item.entityLabel);
    setActivityLog(getActivityLog());
    toast.success("تم الحذف النهائي");
  }

  async function securelyEmptyTrash() {
    if (!trashItems.length) return;
    const pin = window.prompt("أدخل الرقم السري لإفراغ سلة المحذوفات بالكامل:")?.trim();
    if (!pin) return;
    if (!window.confirm(`سيتم حذف ${trashItems.length} عنصرًا نهائيًا ولا يمكن التراجع عن ذلك. هل تريد المتابعة؟`)) return;
    try {
      await verifyPin.mutateAsync({ pin });
      emptyTrash();
      appendActivityLog("إفراغ سلة المحذوفات", `حذف نهائي لـ ${trashItems.length} عنصرًا`);
      setActivityLog(getActivityLog());
      toast.success("تم إفراغ سلة المحذوفات بعد التحقق من الرقم السري");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر التحقق من الرقم السري؛ لم تُحذف أي عناصر.");
    }
  }

  function createPerformanceCustomers() {
    if (!window.confirm("سيتم إنشاء 1000 عميل تجريبي بأسماء تبدأ بـ عميل تجريبي للأداء، مع زيارات وتواريخ ومبالغ اختبارية مرتبطة بهم. لن يتأثر العملاء الحقيقيون. هل تريد المتابعة؟")) return;
    seedPerformanceCustomers.mutate();
  }

  function removePerformanceCustomers() {
    const pin = window.prompt("لحذف العملاء التجريبيين فقط، أدخل الرقم السري:")?.trim();
    if (!pin) return;
    if (!window.confirm("سيتم حذف العملاء الموسومين كبيانات أداء تجريبية فقط. العملاء الحقيقيون لن يتأثروا. هل تريد المتابعة؟")) return;
    deletePerformanceCustomers.mutate({ pin });
  }

  function savePin(event: React.FormEvent) {
    event.preventDefault();
    const current = currentPin.trim();
    const next = newPin.trim();
    if (next.length < 4) { toast.error("اكتب رقمًا سريًا من 4 أحرف أو أرقام على الأقل."); return; }
    if (next !== confirmPin.trim()) { toast.error("تأكيد الرقم السري غير مطابق."); return; }
    setPin.mutate({ newPin: next, currentPin: current || undefined });
  }

  return <div className="mx-auto max-w-5xl space-y-6" dir="rtl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="page-heading">الإعدادات</h1><p className="page-subheading">اضبط كل ما يخص نقطة نقاء من مكان واحد. الإعدادات تحفظ على هذا الجهاز وتعمل دون إنترنت.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800">{savedAt ? `آخر حفظ ${savedAt}` : "إعدادات محلية"}</span><Button onClick={saveAll} className="rounded-xl bg-teal-700 hover:bg-teal-800"><Save className="ml-1 h-4 w-4" />حفظ كل الإعدادات</Button></div></div>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="flex items-start gap-3 border-b border-teal-950/6 p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-700"><SlidersHorizontal className="h-5 w-5" /></div><div><h2 className="font-extrabold">بيانات الشركة وطريقة العرض</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">هذه البيانات تستخدم كإعدادات عامة للتطبيق والتقارير والتصدير والبيانات الجديدة.</p></div></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label><span className="field-label">اسم الشركة</span><input className="field-input" value={settings.companyName} onChange={event => update("companyName", event.target.value)} /></label><label><span className="field-label">رقم هاتف الشركة</span><input className="field-input" value={settings.companyPhone} onChange={event => update("companyPhone", event.target.value)} placeholder="مثال: 01000000000" /></label><label><span className="field-label">عنوان الشركة</span><input className="field-input" value={settings.companyAddress} onChange={event => update("companyAddress", event.target.value)} /></label><label><span className="field-label">اسم الفني الافتراضي</span><input className="field-input" value={settings.defaultTechnician} onChange={event => update("defaultTechnician", event.target.value)} placeholder="يظهر تلقائيًا في الزيارات الجديدة" /></label><label><span className="field-label">تنسيق التاريخ</span><select className="field-input" value={settings.dateFormat} onChange={event => update("dateFormat", event.target.value as AppSettings["dateFormat"])}><option value="arabic">عربي</option><option value="gregorian">إنجليزي/ميلادي</option></select></label><div className="sm:col-span-2"><Toggle checked={settings.useArabicDigits} onChange={value => update("useArabicDigits", value)} label="استخدام الأرقام العربية في العرض والتقارير" /></div></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100 text-violet-700"><ImageIcon className="h-5 w-5" /></div><div><h2 className="font-extrabold">مظهر أصناف المخزن</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">اختر رمزًا تعبيريًا أو ارفع صورة حقيقية لكل صنف. الصورة تُضغط على الجهاز قبل رفعها وتظهر في بطاقات المخزن وبطاقات الاختيار.</p></div></div></div><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{inventoryQuery.isLoading ? <div className="rounded-xl bg-slate-50 p-4 text-sm text-muted-foreground">جارٍ تحميل أصناف المخزن…</div> : (inventoryQuery.data?.items ?? []).length ? (inventoryQuery.data?.items ?? []).map(item => { const draft = appearanceDrafts[item.id] ?? { emoji: item.customEmoji ?? "" }; const imageSrc = draft.previewUrl ?? item.imageUrl ?? undefined; return <article key={item.id} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-50 text-3xl text-violet-700">{imageSrc ? <img src={imageSrc} alt="" className="h-full w-full object-cover" /> : draft.emoji ? <span>{draft.emoji}</span> : <Smile className="h-7 w-7" />}</div><div className="min-w-0"><h3 className="truncate font-extrabold text-teal-950">{item.name}</h3><p className="mt-1 text-xs font-bold text-muted-foreground">رقم المخزون: {item.id}</p><p className="mt-1 text-xs text-muted-foreground">الرصيد الحالي: {item.currentBalance}</p></div></div><div className="mt-4 flex flex-wrap gap-1.5">{inventoryEmojiOptions.map(emoji => <button key={emoji} type="button" aria-label={`اختيار الرمز ${emoji}`} onClick={() => updateAppearanceDraft(item.id, { emoji, clearImage: false })} className={`grid h-8 w-8 place-items-center rounded-lg text-lg transition ${draft.emoji === emoji ? "bg-violet-100 ring-2 ring-violet-400" : "bg-slate-50 hover:bg-violet-50"}`}>{emoji}</button>)}</div><div className="mt-3 flex items-center gap-2"><label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-3 py-2 text-xs font-bold text-violet-800"><ImageIcon className="h-4 w-4 shrink-0" /><span className="truncate">رفع صورة حقيقية</span><input type="file" accept="image/*" className="sr-only" onChange={event => chooseItemImage(item.id, event.target.files?.[0])} /></label>{imageSrc ? <Button type="button" variant="outline" size="sm" onClick={() => updateAppearanceDraft(item.id, { imageDataUrl: undefined, previewUrl: undefined, clearImage: true })} className="rounded-xl border-rose-200 px-2 text-xs text-rose-700">إزالة</Button> : null}</div><div className="mt-3 flex gap-2"><input className="field-input min-w-0 flex-1" value={draft.emoji} onChange={event => updateAppearanceDraft(item.id, { emoji: event.target.value.slice(0, 4), clearImage: false })} placeholder="أو اكتب رمزًا" /><Button type="button" onClick={() => saveItemAppearance(item)} disabled={updateAppearance.isPending} className="rounded-xl bg-violet-700 px-4 hover:bg-violet-800">حفظ</Button></div></article>; }) : <div className="rounded-xl bg-slate-50 p-4 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">لا توجد أصناف في المخزن بعد. أضف صنفًا أولًا من صفحة المخزن.</div>}</div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><span className="text-lg font-black">WA</span></div><div><h2 className="font-extrabold">استيراد مواقع واتساب</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">الخيار اليدوي يعمل الآن من نموذج العميل: الصق رابط الموقع أو الإحداثيات من واتساب وسيحفظ التطبيق الرابط ويستخرج الإحداثيات المتاحة. أما الاستيراد التلقائي فيحتاج حساب WhatsApp Business Platform رسميًا.</p></div></div></div><div className="grid gap-3 p-5 sm:grid-cols-2"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-extrabold text-emerald-900">الخيار اليدوي</p><p className="mt-1 text-xs leading-6 text-emerald-800">متاح دون إعدادات إضافية، ومناسب عندما يرسل العميل الموقع في محادثة واتساب عادية.</p><span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold text-emerald-700">مفعّل الآن</span></div><div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="font-extrabold text-sky-950">التكامل الرسمي API</p><p className="mt-1 text-xs leading-6 text-sky-900">يتطلب Meta Business، رقم WhatsApp Business، وPhone Number ID وAccess Token وWebhook. لا نضع رمز الوصول داخل الواجهة أو في المتصفح.</p><span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold text-sky-700">غير مهيأ حالياً — جاهز للتفعيل بعد توفير بيانات Meta</span></div></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">العملاء والزيارات والمتابعة</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">تحكم في القيم الافتراضية التي تظهر أثناء تسجيل العميل والزيارة وحساب موعد المتابعة.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label><span className="field-label">مدة المتابعة التلقائية بالأيام</span><div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3 text-sm font-extrabold text-teal-900"><span className="block">120 يوماً ثابتة من تاريخ الزيارة الفعلي</span><span className="mt-1 block text-xs font-semibold text-teal-800">لا يمكن تغييرها من الإعدادات حتى لا يختلف موعد المتابعة بين الصفحات.</span></div></label><label><span className="field-label">طريقة كود العميل</span><select className="field-input" value={settings.customerCodeMode} onChange={event => update("customerCodeMode", event.target.value as AppSettings["customerCodeMode"])}><option value="automatic">تلقائي بالترتيب</option><option value="manual">إدخال يدوي</option></select></label><label><span className="field-label">نوع الزيارة الافتراضي</span><select className="field-input" value={settings.defaultVisitType} onChange={event => update("defaultVisitType", event.target.value as AppSettings["defaultVisitType"])}>{visitTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="field-label">عدد أيام التذكير قبل الموعد</span><input type="number" min={0} max={30} className="field-input" value={settings.reminderLeadDays} onChange={event => update("reminderLeadDays", Math.max(0, Number(event.target.value) || 0))} /></label></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">التنبيهات والمواعيد</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">حدد طريقة ظهور التنبيهات ووقت إصدارها، مع بقاء التحكم المتقدم بإذن الجهاز في بطاقة التنبيهات.</p></div><div className="grid gap-3 p-5 sm:grid-cols-2"><Toggle checked={settings.remindersEnabled} onChange={value => update("remindersEnabled", value)} label="تفعيل تنبيهات المواعيد داخل التطبيق" /><Toggle checked={settings.reminderSoundEnabled} onChange={value => update("reminderSoundEnabled", value)} label="تفعيل صوت تنبيه المواعيد" /><Toggle checked={settings.reminderKeepVisibleNextDay} onChange={value => update("reminderKeepVisibleNextDay", value)} label="إبقاء التنبيه ظاهرًا في اليوم التالي" /><label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><span>وقت التنبيه</span><input type="time" className="field-input max-w-[150px]" value={`${String(settings.reminderHour).padStart(2, "0")}:${String(settings.reminderMinute).padStart(2, "0")}`} onChange={event => { const [hour, minute] = event.target.value.split(":").map(Number); update("reminderHour", hour); update("reminderMinute", minute); }} /></label></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">لوحة التحكم والتقارير</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">اختر البطاقات التي تحتاجها يوميًا، وحدد طريقة التعامل مع الجداول والنسخ الاحتياطية.</p></div><div className="grid gap-3 p-5 sm:grid-cols-2"><Toggle checked={settings.dashboardShowUpcoming} onChange={value => update("dashboardShowUpcoming", value)} label="إظهار بطاقة الزيارات القادمة" /><Toggle checked={settings.dashboardShowDue} onChange={value => update("dashboardShowDue", value)} label="إظهار بطاقة المتابعة المستحقة" /><Toggle checked={settings.dashboardShowCash} onChange={value => update("dashboardShowCash", value)} label="إظهار بطاقة الخزينة" /><Toggle checked={settings.dashboardShowInventory} onChange={value => update("dashboardShowInventory", value)} label="إظهار بطاقة المخزن" /><Toggle checked={settings.compactTables} onChange={value => update("compactTables", value)} label="عرض الجداول بوضع مختصر" /><Toggle checked={settings.compactCustomersOnMobile} onChange={value => update("compactCustomersOnMobile", value)} label="عرض مبسط لبطاقات العملاء على الهاتف" /><Toggle checked={settings.compactVisitsOnMobile} onChange={value => update("compactVisitsOnMobile", value)} label="عرض مبسط لبطاقات الزيارات على الهاتف" /><label><span className="field-label">التذكير بالنسخ الاحتياطي كل</span><select className="field-input" value={settings.backupReminderDays} onChange={event => update("backupReminderDays", Number(event.target.value))}><option value={0}>بدون تذكير</option><option value={7}>7 أيام</option><option value={14}>14 يومًا</option><option value={30}>30 يومًا</option></select></label></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">العمل دون إنترنت والمزامنة</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">هذه الخيارات تحافظ على سرعة التسجيل وتحدد سلوك المزامنة عند عودة الإنترنت.</p></div><div className="grid gap-3 p-5 sm:grid-cols-2"><Toggle checked={settings.autoSaveLocally} onChange={value => update("autoSaveLocally", value)} label="الحفظ المحلي التلقائي لكل عملية" /><Toggle checked={settings.syncWhenOnline} onChange={value => update("syncWhenOnline", value)} label="المزامنة تلقائيًا عند عودة الإنترنت" /><Toggle checked={settings.confirmDestructiveActions} onChange={value => update("confirmDestructiveActions", value)} label="طلب تأكيد قبل الحذف أو الاستعادة" /></div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">رواتب وعمولات الفنيين</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">حدد الراتب الشهري الثابت ونسبة عمولة التركيبات والصيانة لكل فني. القيم صفر افتراضيًا، والعمولة المستحقة لا تعني أنها دُفعت نقدًا.</p></div><div className="space-y-4 p-5"><div className="flex flex-col gap-2 sm:flex-row"><input className="field-input flex-1" value={technicianNameDraft} onChange={event => setTechnicianNameDraft(event.target.value)} placeholder="اكتب اسم الفني لإضافته" /><Button type="button" variant="outline" onClick={addTechnician} className="rounded-xl border-teal-700/30 text-teal-800">إضافة فني</Button></div>{Object.keys(settings.technicianPayroll).length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-3 py-3">الفني</th><th className="px-3 py-3">الراتب الشهري</th><th className="px-3 py-3">عمولة التركيبات %</th><th className="px-3 py-3">عمولة الصيانة %</th><th className="px-3 py-3">إجراء</th></tr></thead><tbody className="divide-y">{Object.entries(settings.technicianPayroll).map(([name, profile]) => <tr key={name}><td className="px-3 py-3 font-bold">{name}</td><td className="px-3 py-2"><input type="number" min="0" step="0.01" className="field-input w-40" value={profile.monthlySalary.toString()} onChange={event => updateTechnician(name, "monthlySalary", Math.round(Number(event.target.value || 0)))} /></td><td className="px-3 py-2"><input type="number" min="0" max="100" step="0.01" className="field-input w-32" value={profile.installationPercent} onChange={event => updateTechnician(name, "installationPercent", Number(event.target.value))} /></td><td className="px-3 py-2"><input type="number" min="0" max="100" step="0.01" className="field-input w-32" value={profile.maintenancePercent} onChange={event => updateTechnician(name, "maintenancePercent", Number(event.target.value))} /></td><td className="px-3 py-2"><Button type="button" variant="outline" className="rounded-lg border-rose-200 text-rose-700" onClick={() => removeTechnician(name)}>حذف الإعداد</Button></td></tr>)}</tbody></table></div> : <div className="rounded-xl bg-slate-50 p-4 text-sm text-muted-foreground">لم تتم إضافة فنيين بعد. يمكنك إضافة الأسماء الآن وترك الراتب والنسب بصفر.</div>}</div></details>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="flex items-start gap-3 border-b border-teal-950/6 p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-100 text-teal-700"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-extrabold">الرقم السري للحماية</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">يُستخدم لحماية تعديل وحذف العملاء والزيارات والخزينة والمخزن والتذكيرات.</p></div></div><form onSubmit={savePin} className="space-y-4 p-5"><div className="grid gap-4 md:grid-cols-3"><label><span className="field-label">الرقم السري الحالي</span><input type={showPins ? "text" : "password"} className="field-input" value={currentPin} onChange={event => setCurrentPin(event.target.value)} placeholder="اتركه فارغًا عند الإعداد لأول مرة" autoComplete="current-password" /></label><label><span className="field-label">الرقم السري الجديد</span><input type={showPins ? "text" : "password"} className="field-input" value={newPin} onChange={event => setNewPin(event.target.value)} placeholder="4 أحرف أو أرقام على الأقل" autoComplete="new-password" minLength={4} required /></label><label><span className="field-label">تأكيد الرقم السري الجديد</span><input type={showPins ? "text" : "password"} className="field-input" value={confirmPin} onChange={event => setConfirmPin(event.target.value)} placeholder="أعد كتابة الرقم السري" autoComplete="new-password" minLength={4} required /></label></div><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => setShowPins(value => !value)} className="rounded-xl border-teal-700/20 text-teal-800 hover:bg-teal-50">{showPins ? <EyeOff className="ml-1 h-4 w-4" /> : <Eye className="ml-1 h-4 w-4" />}{showPins ? "إخفاء الأرقام" : "إظهار الأرقام"}</Button><Button type="submit" disabled={setPin.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800"><KeyRound className="ml-1 h-4 w-4" />{setPin.isPending ? "جارٍ الحفظ…" : "حفظ الرقم السري"}</Button></div><p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">إذا كان هذا أول إعداد للرقم السري، اترك خانة الرقم الحالي فارغة. لا تشارك الرقم السري مع غير المصرح لهم.</p></form></details>

    <section className="soft-card overflow-hidden border border-amber-200"><div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/60 p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700"><span className="text-lg font-black">1000</span></div><div><h2 className="font-extrabold text-amber-950">اختبار أداء التطبيق</h2><p className="mt-1 text-xs leading-6 text-amber-900">ينشئ هذا الاختبار 1000 عميل تجريبي موسومًا بوضوح، مع زيارات وتواريخ ومبالغ اختبارية مرتبطة بهم، حتى تختبر العملاء والتقارير والخزينة والبحث والتنقل. احذفهم من هنا بعد انتهاء الاختبار.</p></div></div><div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold text-slate-700">يشمل الحذف العملاء التجريبيين وكل الزيارات والتذكيرات والمعاملات المرتبطة بهم فقط.</p><div className="flex flex-wrap gap-2"><Button type="button" className="rounded-xl bg-amber-700 hover:bg-amber-800" onClick={createPerformanceCustomers} disabled={seedPerformanceCustomers.isPending}>{seedPerformanceCustomers.isPending ? `جارٍ الإنشاء… ${performanceElapsedSeconds ? `(${performanceElapsedSeconds} ث)` : ""}` : "إنشاء 1000 عميل تجريبي"}</Button><Button type="button" variant="outline" className="rounded-xl border-rose-300 text-rose-800 hover:bg-rose-50" onClick={removePerformanceCustomers} disabled={deletePerformanceCustomers.isPending}>{deletePerformanceCustomers.isPending ? `جارٍ الحذف… ${performanceElapsedSeconds ? `(${performanceElapsedSeconds} ث)` : ""}` : "حذف كل البيانات التجريبية"}</Button></div></div></section>

    <section className="soft-card overflow-hidden border border-rose-200"><div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/50 p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700"><Trash2 className="h-5 w-5" /></div><div><h2 className="font-extrabold text-rose-950">منطقة الحذف المتقدم</h2><p className="mt-1 text-xs leading-6 text-rose-800">يوجد خياران منفصلان: حذف العملاء والزيارات فقط، أو مسح كل بيانات التطبيق بما فيها الخزينة والمخزن وأوامر الفنيين. لا يمكن التراجع عن المسح الشامل.</p></div></div><div className="flex flex-col gap-4 p-5"><p className="text-sm font-semibold text-slate-700">استخدم هذه الأدوات عند بدء قاعدة بيانات جديدة، وبعد التأكد من عدم وجود بيانات حقيقية أو أخذ نسخة احتياطية.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="rounded-xl border-rose-300 font-bold text-rose-800 hover:bg-rose-50" onClick={() => setBulkDeleteOpen(true)}><Trash2 className="ml-2 h-4 w-4" />حذف العملاء والزيارات</Button><Button type="button" className="rounded-xl bg-rose-700 font-bold text-white hover:bg-rose-800" onClick={() => setWipeAllOpen(true)}><Trash2 className="ml-2 h-4 w-4" />مسح كل بيانات التطبيق</Button></div></div></section>

    <section ref={trashSectionRef} id="trash-bin" className="soft-card scroll-mt-4 overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-teal-950/6 p-5"><div><h2 className="font-extrabold">سلة المحذوفات</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">هذه سجلات مراجعة اختيارية على هذا الجهاز، وليست بديلاً عن السجلات المحفوظة في قاعدة البيانات المركزية.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">{filteredTrashItems.length} من {trashItems.length} عنصر</span>{trashItems.length > 0 && <Button type="button" size="sm" variant="outline" className="rounded-lg border-rose-300 text-rose-800 hover:bg-rose-50" onClick={securelyEmptyTrash} disabled={verifyPin.isPending}><Trash2 className="ml-1 h-4 w-4" />{verifyPin.isPending ? "جارٍ التحقق..." : "إفراغ السلة بالكامل"}</Button>}</div></div><div className="border-b border-rose-100 bg-rose-50/30 p-4"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative min-w-0 flex-1"><span className="sr-only">البحث في سلة المحذوفات</span><input aria-label="البحث في سلة المحذوفات" value={trashSearch} onChange={event => setTrashSearch(event.target.value)} className="field-input pr-3" placeholder="بحث باسم العميل أو الزيارة أو الوصف" /></label><select aria-label="تصفية نوع المحذوف" value={trashType} onChange={event => setTrashType(event.target.value as typeof trashType)} className="field-input sm:w-52"><option value="all">كل العناصر</option><option value="customer">العملاء</option><option value="visit">الزيارات</option><option value="cash">الخزينة</option><option value="inventory">أصناف وحركات المخزن</option><option value="reminder">التذكيرات</option><option value="technician-settings">إعدادات الفنيين</option></select><Button type="button" variant="outline" className="rounded-xl" onClick={() => { setTrashSearch(""); setTrashType("all"); }} disabled={!trashSearch && trashType === "all"}>مسح الفلاتر</Button></div></div><div className="space-y-2 p-5">{filteredTrashItems.length ? filteredTrashItems.map(item => <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-rose-950">{item.entityLabel}</p><p className="mt-1 text-xs leading-6 text-rose-800">حُذف بواسطة <span className="font-bold">{item.deletedBy || "مستخدم سابق"}</span> في {new Date(item.deletedAt).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" })}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" className="rounded-lg bg-teal-700 hover:bg-teal-800" onClick={() => restoreTrashItem(item)}><Undo2 className="ml-1 h-4 w-4" />استعادة</Button><Button type="button" size="sm" variant="outline" className="rounded-lg border-rose-300 text-rose-800" onClick={() => permanentlyDeleteTrashItem(item)}><Trash2 className="ml-1 h-4 w-4" />حذف نهائي</Button></div></div>) : <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-muted-foreground">{trashItems.length ? "لا توجد عناصر تطابق البحث أو الفلتر الحالي." : "سلة المحذوفات فارغة حاليًا."}</p>}</div></section>

    <details className="soft-card overflow-hidden group" open><summary className="cursor-pointer list-none border-b border-teal-950/6 bg-teal-50/40 px-5 py-3 text-sm font-extrabold text-teal-900 marker:hidden">فتح أو إخفاء هذا القسم</summary><div className="flex flex-wrap items-start justify-between gap-3 border-b border-teal-950/6 p-5"><div><h2 className="font-extrabold">سجل التغييرات</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">يُحفظ سجل مراجعة مختصر على هذا الجهاز للمساعدة في التدقيق؛ أما البيانات التشغيلية فتُقرأ من الخادم المركزي.</p></div><Button type="button" variant="outline" className="rounded-xl border-rose-200 text-rose-700" onClick={() => { if (settings.confirmDestructiveActions && !window.confirm("مسح سجل التغييرات فقط؟")) return; clearActivityLog(); setActivityLog([]); toast.success("تم مسح سجل التغييرات"); }}>مسح السجل</Button></div><div className="space-y-2 p-5">{activityLog.length ? activityLog.slice(0, 8).map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs"><span className="font-bold text-teal-900">{entry.action}: {entry.details}</span><time className="text-muted-foreground" dir="ltr">{new Date(entry.createdAt).toLocaleString("ar-SA")}</time></div>) : <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-muted-foreground">لا توجد تغييرات مسجلة بعد.</p>}</div></details>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs leading-6 text-rose-900">إعادة الإعدادات لا تحذف العملاء أو الزيارات أو الخزينة أو المخزن؛ تعيد تفضيلات العرض والتشغيل فقط.</p><Button variant="outline" onClick={restoreDefaults} className="rounded-xl border-rose-300 text-rose-800 hover:bg-rose-100"><RotateCcw className="ml-1 h-4 w-4" />إعادة الإعدادات الافتراضية</Button></div>
    <PinVerificationDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen} busy={deleteAllCustomers.isPending} title="تأكيد حذف العملاء والزيارات" description="سيتم حذف العملاء والزيارات والتذكيرات المرتبطة نهائيًا، مع الحفاظ على الخزينة والمخزن." onConfirm={pin => { deleteAllCustomers.mutate({ pin, confirmation: "حذف جميع العملاء" }, { onSuccess: result => { setBulkDeleteOpen(false); toast.success(`تم حذف ${result.deletedCustomers} عميل و${result.deletedVisits} زيارة`); }, onError: error => toast.error(error.message) }); }} />
    <PinVerificationDialog open={wipeAllOpen} onOpenChange={setWipeAllOpen} busy={wipeAllData.isPending} title="تأكيد مسح كل بيانات التطبيق" description="أدخل الرقم السري أولًا. بعد ذلك سيظهر تأكيد نهائي لمسح العملاء والزيارات والتذكيرات وأوامر الفنيين والخزينة والمخزن والعمولات التشغيلية." onConfirm={pin => { if (!window.confirm("تأكيد نهائي: سيتم مسح كل بيانات التطبيق، بما فيها الخزينة والمخزن وأوامر الفنيين، ولا يمكن التراجع. هل تريد المتابعة؟")) return; wipeAllData.mutate({ pin, confirmation: "مسح كل بيانات التطبيق" }); }} />
  </div>;
}
