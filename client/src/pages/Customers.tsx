import { Badge } from "@/components/ui/badge";
import { PinVerificationDialog } from "@/components/PinVerificationDialog";
import { MapView } from "@/components/Map";
import { CustomerContactActions } from "@/components/CustomerContactActions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatDateTime, visitTypeLabels } from "@/lib/filterUi";
import { customerExcelHeaders, customerRowsForExcel, downloadCustomerImportIssues, downloadCustomerImportTemplate, downloadRowsAsExcel, parseCustomerClipboard, parseCustomerExcel, parseCustomerPdf, withArabicHeaders, type CustomerImportIssue, type CustomerImportRow } from "@/lib/excelExport";
import { printArabicPdf } from "@/lib/pdfExport";
import { moveToTrash } from "@/lib/trashBin";
import { formatAppMoney, getAppSettings, saveAppSettings } from "@/lib/appSettings";
import { parseWhatsAppLocationText } from "@/lib/locationParser";
import { extractArray } from "@/lib/dataNormalization";
import { AlertCircle, CalendarDays, CheckCircle2, CircleHelp, Clock3, Download, FileSpreadsheet, Loader2, LayoutGrid, Pencil, Plus, Search, Table2, Trash2, Upload, UsersRound } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type VisitType = "installation" | "maintenance" | "cartridge_change" | "follow_up" | "other";
export type UsedVisitItem = { inventoryItemId: number; quantity: number; source: "default" | "manual" };
export type CatalogItem = { id: number; name: string; unit?: string; currentBalance?: number };
type CustomerForm = { id?: number; manualCode: string; name: string; phone: string; address: string; location: string; notes: string; firstVisitType: VisitType; firstVisitDate: string; firstTechnicianName: string; firstTechnicianId: string; firstSalesAgentName: string; firstFilterCount: string; firstTdsIn: string; firstTdsOut: string; firstVisitResult: string; firstVisitNotes: string; firstCollectedAmount: string; firstVisitItems: UsedVisitItem[] };
function toDateTimeLocal() { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }
function parseLocation(value: string) { const parsed = parseWhatsAppLocationText(value); return { latitude: parsed.latitude, longitude: parsed.longitude }; }
export type CustomerCardStatus = "overdue" | "due_soon" | "regular";

export function getCustomerCardStatus(daysRemaining: number | null | undefined): CustomerCardStatus {
  if (daysRemaining == null) return "regular";
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= 7) return "due_soon";
  return "regular";
}

function customerCardTone(status: CustomerCardStatus) {
  if (status === "overdue") return { card: "border-rose-300 bg-rose-50/70", badge: "border-rose-200 bg-rose-100 text-rose-800", accent: "text-rose-950", muted: "text-rose-800", panel: "bg-rose-100/70" };
  if (status === "due_soon") return { card: "border-amber-300 bg-amber-50/70", badge: "border-amber-200 bg-amber-100 text-amber-900", accent: "text-amber-950", muted: "text-amber-800", panel: "bg-amber-100/70" };
  return { card: "border-emerald-300 bg-emerald-50/70", badge: "border-emerald-200 bg-emerald-100 text-emerald-800", accent: "text-emerald-950", muted: "text-emerald-800", panel: "bg-emerald-100/70" };
}

function followUpBadge(daysRemaining: number) { if (daysRemaining < 0) return { label: "متأخر", className: "border-rose-200 bg-rose-100 text-rose-800 hover:bg-rose-100", ariaLabel: "العميل متأخر عن موعد المتابعة" }; if (daysRemaining <= 5) return { label: daysRemaining === 0 ? "قريب · اليوم" : "قريب", className: "border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-100", ariaLabel: daysRemaining === 0 ? "موعد متابعة العميل قريب وهو اليوم" : "موعد متابعة العميل قريب" }; return { label: "أكثر من ٥ أيام", className: "border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100", ariaLabel: "موعد متابعة العميل بعد أكثر من خمسة أيام" }; }
const emptyCustomer: CustomerForm = { manualCode: "", name: "", phone: "", address: "", location: "", notes: "", firstVisitType: "installation", firstVisitDate: toDateTimeLocal(), firstTechnicianName: "", firstTechnicianId: "", firstSalesAgentName: "", firstFilterCount: "1", firstTdsIn: "", firstTdsOut: "", firstVisitResult: "", firstVisitNotes: "", firstCollectedAmount: "", firstVisitItems: [] };

type ServiceCatalog = {
  types: Array<{ id: number; code: string; name: string }>;
  mappings: Array<{ serviceTypeId: number; inventoryItemId: number; defaultQuantity: number; isRequired: boolean; allowEditQuantity: boolean }>;
  items: Array<CatalogItem & { unit: string; currentBalance: number }>;
};

function normalizeServiceCatalog(response: unknown): ServiceCatalog | null {
  const source = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : null;
  const nested = source?.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data as Record<string, unknown> : source;
  if (!nested || !Array.isArray(nested.types) || !Array.isArray(nested.mappings) || !Array.isArray(nested.items)) return null;
  return { types: nested.types as ServiceCatalog["types"], mappings: nested.mappings as ServiceCatalog["mappings"], items: nested.items as ServiceCatalog["items"] };
}

export function addOrIncrementVisitItem(items: UsedVisitItem[], item: CatalogItem, quantity = 1): UsedVisitItem[] {
  const available = item.currentBalance;
  const existing = items.find(entry => entry.inventoryItemId === item.id);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (available !== undefined && nextQuantity > available) return items;
  if (existing) return items.map(entry => entry.inventoryItemId === item.id ? { ...entry, quantity: nextQuantity, source: "manual" as const } : entry);
  return [...items, { inventoryItemId: item.id, quantity, source: "manual" as const }];
}

export function buildPartsConfirmation(items: Array<{ inventoryItemId: number; quantity: number }>, catalogItems: Array<{ id: number; name: string }>) {
  const summary = items.map(item => {
    const catalogItem = catalogItems.find(entry => entry.id === item.inventoryItemId);
    return `• ${catalogItem?.name ?? `صنف رقم ${item.inventoryItemId}`}: ${item.quantity}`;
  }).join("\\n");
  return `قطع الغيار التي سيتم صرفها:\\n${summary}\\n\\nهل تريد حفظ الزيارة وخصم هذه الكميات من المخزن؟`;
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);
  const [followUpStatus, setFollowUpStatus] = useState<"all" | "overdue" | "today" | "within_5_days" | "more_than_5_days" | "upcoming" | "regular" | "none">("all");
  const [sortBy, setSortBy] = useState<"created_desc" | "next_asc" | "next_desc" | "status" | "collected_desc" | "collected_asc">("created_desc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyCustomer);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [visitCustomer, setVisitCustomer] = useState<NonNullable<typeof customers>[number] | null>(null);
  const [visitPickerOpen, setVisitPickerOpen] = useState(false);
  const [visitPickerCustomerId, setVisitPickerCustomerId] = useState("");
  const [visitPickerSearch, setVisitPickerSearch] = useState("");
  const [visitType, setVisitType] = useState<keyof typeof visitTypeLabels>("maintenance");
  const [visitDate, setVisitDate] = useState(toDateTimeLocal());
  const [visitNotes, setVisitNotes] = useState("");
  const [visitResult, setVisitResult] = useState("");
  const [visitTechnicianName, setVisitTechnicianName] = useState("");
  const [visitTechnicianId, setVisitTechnicianId] = useState("");
  const [visitSalesAgentName, setVisitSalesAgentName] = useState("");
  const [visitFilterCount, setVisitFilterCount] = useState("1");
  const [visitCollectedAmount, setVisitCollectedAmount] = useState("");
  const [visitTdsIn, setVisitTdsIn] = useState("");
  const [visitTdsOut, setVisitTdsOut] = useState("");
  const [visitItems, setVisitItems] = useState<Array<{ inventoryItemId: number; quantity: number; source: "default" | "manual" }>>([]);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemQuantity, setManualItemQuantity] = useState("1");
  const [firstManualItemName, setFirstManualItemName] = useState("");
  const [firstManualItemQuantity, setFirstManualItemQuantity] = useState("1");
  const input = useMemo(() => ({ search: search || undefined, followUpStatus, sortBy }), [search, followUpStatus, sortBy]);
  const statusInput = useMemo(() => ({ search: search || undefined, followUpStatus: "all" as const, sortBy }), [search, sortBy]);
  const { data: customers, isLoading, isError, refetch: refetchCustomers } = trpc.filters.customers.list.useQuery(input, {
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const { data: statusCustomers } = trpc.filters.customers.list.useQuery(statusInput, {
    enabled: followUpStatus !== "all",
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    networkMode: "online",
  });
  const { data: notificationSettings } = trpc.filters.notifications.settings.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const techniciansQuery = trpc.filters.technicians?.list?.useQuery?.(undefined, { retry: false, staleTime: 60_000 });
  const visibleTechnicians = extractArray<NonNullable<typeof techniciansQuery.data>[number]>(techniciansQuery?.data);
  const salesAgentNames = Object.keys(getAppSettings().salesAgents).sort((a, b) => a.localeCompare(b, "ar"));
  const serviceCatalogQuery = trpc.filters.serviceTypes?.list?.useQuery?.();
  const serviceCatalog = normalizeServiceCatalog(serviceCatalogQuery?.data);
  const effectiveServiceCatalog = serviceCatalog;
  const handledRouteRequest = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const [location, setLocation] = useLocation();
  const createCustomer = trpc.filters.customers.create.useMutation({ onSuccess: () => { utils.filters.customers.list.invalidate(); utils.filters.dashboard.invalidate(); toast.success("تمت إضافة العميل بنجاح"); setDialogOpen(false); }, onError: error => toast.error(error.message || "تعذر إضافة العميل. يرجى المحاولة مرة أخرى.") });
  const deleteCustomer = trpc.filters.customers.delete.useMutation({ onSuccess: () => { utils.filters.customers.list.invalidate(); utils.filters.dashboard.invalidate(); setDeleteId(null); toast.success("تم حذف العميل وسجلاته المرتبطة"); }, onError: error => toast.error(error.message || "تعذر حذف العميل.") });
  const importCustomers = trpc.filters.customers.importBulk.useMutation({ onSuccess: result => { utils.filters.customers.list.invalidate(); utils.filters.dashboard.invalidate(); const rejectedWithData = result.rejected.map(issue => { const row = importRows.find(item => item.rowNumber === issue.rowNumber); return { ...issue, data: row ? { "كود العميل": row.manualCode ?? "", "اسم العميل": row.name, "الهاتف": row.phone, "العنوان": row.address ?? "", "الموقع": row.location ?? "", "ملاحظات": row.notes ?? "", "الفني": row.technicianName ?? "", "تاريخ الزيارة": row.visitDate ?? "", "نوع الزيارة": row.visitType ?? "", "المبلغ": row.collectedAmount ?? "" } : undefined }; }); setImportMessage(`تمت معالجة ${result.processed ?? result.total} صفًا من أصل ${result.total}: أُضيف ${result.added} عميلًا جديدًا، ورُبط ${result.linked ?? 0} صفًا بعملاء موجودين، وسُجلت ${result.visitsAdded ?? 0} زيارة و${result.incomeAdded ?? 0} إيراد خزنة، واحتاج ${result.rejected.length} صفًا للمراجعة.`); setImportIssues(rejectedWithData); toast.success(`تمت معالجة ${result.total} صفًا؛ العملاء الجدد ${result.added} والصفوف المرتبطة ${result.linked ?? 0}`); }, onError: error => toast.error(error.message || "تعذر استيراد ملف العملاء.") });

  const createVisit = trpc.filters.visits.create.useMutation({
    onSuccess: result => {
      utils.filters.customers.list.invalidate();
      utils.filters.dashboard.invalidate();
      utils.filters.reminders.due.invalidate();
      utils.filters.inventory.summary.invalidate();
      setVisitCustomer(null);
      setVisitNotes("");
      setVisitResult(""); setVisitTechnicianName(""); setVisitTechnicianId(""); setVisitSalesAgentName(""); setVisitFilterCount("1"); setVisitCollectedAmount(""); setVisitTdsIn(""); setVisitTdsOut(""); toast.success(result.reminderCreated ? "تم تسجيل الزيارة وإنشاء تذكير بعد 120 يومًا" : "تم تسجيل الزيارة بنجاح");
    },
    onError: error => toast.error(error.message || "تعذر تسجيل الزيارة. يرجى المحاولة مرة أخرى."),
  });

  const updateCustomer = trpc.filters.customers.update.useMutation({ onSuccess: () => { utils.filters.customers.list.invalidate(); utils.filters.customers.get.invalidate(); utils.filters.dashboard.invalidate(); utils.filters.reminders.due.invalidate(); toast.success("تم تعديل بيانات العميل"); setDialogOpen(false); }, onError: error => toast.error(error.message || "تعذر تعديل بيانات العميل. يرجى المحاولة مرة أخرى.") });
  const saving = createCustomer.isPending || updateCustomer.isPending;
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const isOffline = !online;
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  const locationPreview = useMemo(() => parseWhatsAppLocationText(form.location), [form.location]);
  const [compactMobile, setCompactMobile] = useState(() => getAppSettings().compactCustomersOnMobile);
  const [customerView, setCustomerView] = useState<"cards" | "table">("cards");
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<CustomerImportRow[]>([]);
  const [importIssues, setImportIssues] = useState<CustomerImportIssue[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSheetNames, setImportSheetNames] = useState<string[]>([]);
  const [importSheetName, setImportSheetName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [sharedLocationOpen, setSharedLocationOpen] = useState(false);
  const [sharedLocationValue, setSharedLocationValue] = useState("");
  const [sharedCustomerId, setSharedCustomerId] = useState("");
  useEffect(() => {
    const onSettingsChange = (event: Event) => setCompactMobile(Boolean((event as CustomEvent<{ compactCustomersOnMobile?: boolean }>).detail?.compactCustomersOnMobile));
    window.addEventListener("purepoint-settings-changed", onSettingsChange);
    return () => window.removeEventListener("purepoint-settings-changed", onSettingsChange);
  }, []);
  const safeCustomers = useMemo(() => extractArray<NonNullable<typeof customers>[number]>(customers), [customers]);
  const safeStatusCustomers = useMemo(() => extractArray<NonNullable<typeof customers>[number]>(statusCustomers), [statusCustomers]);
  const displayedCustomers = safeCustomers;
  const renderedCustomers = useMemo(() => (Array.isArray(displayedCustomers) ? displayedCustomers.slice(0, visibleCount) : []), [displayedCustomers, visibleCount]);
  useEffect(() => { setVisibleCount(100); }, [search, followUpStatus, sortBy]);
  const activeFilterLabel = ({ all: "كل العملاء", overdue: "العملاء المتأخرون", today: "عملاء موعد اليوم", within_5_days: "المتابعة خلال ٥ أيام", more_than_5_days: "أكثر من ٥ أيام", upcoming: "المتابعة خلال ٥ أيام", regular: "أكثر من ٥ أيام", none: "العملاء بدون موعد" } as const)[followUpStatus];
  const statusCards = useMemo(() => {
    const statusSource = Array.isArray(statusCustomers) ? safeStatusCustomers : null;
    const source = statusSource ?? displayedCustomers;
    const counts = { all: source.length, overdue: 0, today: 0, within_5_days: 0, more_than_5_days: 0, none: 0 };
    source.forEach(customer => {
      const followUp = (customer as { followUp?: { daysRemaining: number } | null }).followUp;
      if (!followUp) {
        counts.none += 1;
        return;
      }
      const days = followUp.daysRemaining;
      if (days < 0) counts.overdue += 1;
      else if (days === 0) counts.today += 1;
      else if (days <= 5) counts.within_5_days += 1;
      else counts.more_than_5_days += 1;
    });
    return counts;
  }, [statusCustomers, displayedCustomers]);

  useEffect(() => {
    const requestedStatus = new URLSearchParams(window.location.search).get("followUpStatus");
    const validStatuses = ["all", "overdue", "today", "within_5_days", "more_than_5_days", "upcoming", "regular", "none"] as const;
    if (validStatuses.includes(requestedStatus as (typeof validStatuses)[number]) && requestedStatus !== followUpStatus) {
      setFollowUpStatus(requestedStatus as (typeof validStatuses)[number]);
    }
  }, [location, followUpStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pathname = window.location.pathname.replace(/\/$/, "");
    const queryRequestsNew = params.get("new") === "1" || pathname === "/customers/new";
    const queryRequestsVisit = params.get("visit") === "1" || pathname === "/customers/visit";
    const requestedCustomerId = params.get("customerId") || "";
    const requestKey = queryRequestsNew ? "new" : queryRequestsVisit ? `visit:${requestedCustomerId}` : null;

    // Route aliases are one-shot commands. Clean the browser URL directly;
    // calling setLocation here can synchronously retrigger this effect in wouter.
    if (!requestKey) {
      handledRouteRequest.current = null;
      return;
    }
    if (handledRouteRequest.current === requestKey) return;
    handledRouteRequest.current = requestKey;

    if (queryRequestsNew) {
      setForm({ ...emptyCustomer, firstVisitItems: getDefaultVisitItems("installation") });
      setDialogOpen(true);
    } else {
      const requestedCustomer = requestedCustomerId ? displayedCustomers.find(item => String(item.id) === requestedCustomerId) : null;
      if (requestedCustomer) {
        openVisit(requestedCustomer);
        setVisitPickerOpen(false);
      } else {
        setVisitPickerCustomerId(requestedCustomerId);
        setVisitPickerSearch("");
        setVisitPickerOpen(true);
      }
    }

    window.history.replaceState({}, "", "/customers");
  }, [location, displayedCustomers]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedValue = params.get("url") || params.get("text");
    if (!sharedValue) return;
    const parsed = parseWhatsAppLocationText(sharedValue);
    window.history.replaceState({}, "", "/customers");
    if (!parsed.normalizedLocation) {
      toast.error("تعذر قراءة الموقع المشارك. اختر رابط Google Maps أو أرسل الإحداثيات.");
      return;
    }
    setSharedLocationValue(parsed.normalizedLocation);
    setSharedCustomerId("");
    setSharedLocationOpen(true);
  }, [location]);
  function chooseVisitCustomer(customerId?: number) {
    const selectedId = customerId !== undefined ? String(customerId) : visitPickerCustomerId;
    const customer = displayedCustomers?.find(item => String(item.id) === selectedId);
    if (!customer) {
      toast.error("اختر العميل أولًا");
      return;
    }
    setVisitPickerOpen(false);
    openVisit(customer);
  }

  function applySharedLocation() {
    const customer = displayedCustomers?.find(item => String(item.id) === sharedCustomerId);
    if (!customer) {
      toast.error("اختر العميل الذي أرسل الموقع أولًا");
      return;
    }
    const serviceDate = customer.followUp?.lastServiceVisitDate ? new Date(customer.followUp.lastServiceVisitDate) : new Date();
    serviceDate.setMinutes(serviceDate.getMinutes() - serviceDate.getTimezoneOffset());
    setForm({ ...emptyCustomer, id: customer.id, manualCode: customer.manualCode || "", name: customer.name, phone: customer.phone, address: customer.address || "", location: sharedLocationValue, notes: customer.notes || "", firstVisitDate: serviceDate.toISOString().slice(0, 16) });
    setSharedLocationOpen(false);
    setDialogOpen(true);
  }
  if (isError && !isLoading && safeCustomers.length === 0) return <div className="soft-card p-8 text-center"><p className="font-bold text-teal-950">تعذر تحميل قائمة العملاء من الخادم المركزي.</p><p className="mt-2 text-sm text-muted-foreground">تحقق من الاتصال ثم أعد المحاولة. لا يتم استخدام نسخة محلية كبديل للبيانات المشتركة.</p><Button onClick={() => void refetchCustomers()} variant="outline" className="mt-4 rounded-xl">إعادة المحاولة</Button></div>;

  function openNew() { setForm({ ...emptyCustomer, firstVisitItems: getDefaultVisitItems("installation") }); setDialogOpen(true); }
  function handleCustomerDialogOpenChange(nextOpen: boolean) {
    if (nextOpen === dialogOpen) return;
    setDialogOpen(nextOpen);
    if (!nextOpen) setForm(emptyCustomer);
  }
  function handleVisitPickerOpenChange(nextOpen: boolean) {
    if (nextOpen === visitPickerOpen) return;
    setVisitPickerOpen(nextOpen);
    if (!nextOpen) {
      setVisitPickerCustomerId("");
      setVisitPickerSearch("");
    }
  }
  function handleVisitDialogOpenChange(nextOpen: boolean) {
    const isOpen = visitCustomer !== null;
    if (nextOpen === isOpen) return;
    if (!nextOpen) setVisitCustomer(null);
  }
  function handleImportOpenChange(nextOpen: boolean) {
    if (nextOpen === importOpen) return;
    setImportOpen(nextOpen);
    if (!nextOpen) resetCustomerImport();
  }
  function pasteWhatsAppLocation() {
    const pasted = window.prompt("ألصق هنا رابط الموقع الذي وصلك عبر واتساب أو الإحداثيات بصيغة latitude, longitude:");
    if (pasted === null) return;
    const parsed = parseWhatsAppLocationText(pasted);
    if (!parsed.normalizedLocation) return toast.error(parsed.message);
    setForm(current => ({ ...current, location: parsed.normalizedLocation }));
    if (parsed.latitude && parsed.longitude) toast.success(`${parsed.message} سيتم حفظ الإحداثيات مع العميل.`);
    else toast.info(parsed.message);
  }
  function openVisit(customer: NonNullable<typeof customers>[number]) { setVisitPickerSearch(""); setVisitCustomer(customer); setVisitType("maintenance"); setVisitDate(toDateTimeLocal()); setVisitNotes(""); setVisitResult(""); setVisitTechnicianName(""); setVisitTechnicianId(""); setVisitSalesAgentName(""); setVisitFilterCount("1"); setVisitCollectedAmount(""); setVisitTdsIn(""); setVisitTdsOut(""); setManualItemName(""); setManualItemQuantity("1"); setVisitItems(getDefaultVisitItems("maintenance")); }
  function getDefaultVisitItems(type: keyof typeof visitTypeLabels) { const catalog = effectiveServiceCatalog; if (!catalog) return []; const service = catalog.types.find(item => item.code === type); if (!service) return []; return catalog.mappings.filter(mapping => mapping.serviceTypeId === service.id).map(mapping => ({ inventoryItemId: mapping.inventoryItemId, quantity: mapping.defaultQuantity, source: "default" as const })); }
  function updateVisitType(type: keyof typeof visitTypeLabels) { setVisitType(type); setVisitItems(getDefaultVisitItems(type)); }
  function addManualFirstVisitItem() {
    const name = firstManualItemName.trim();
    const catalogItem = effectiveServiceCatalog?.items.find(item => item.name.trim() === name);
    const quantity = Number.parseInt(firstManualItemQuantity, 10);
    if (!catalogItem) return toast.error("الصنف غير موجود في المخزن؛ أضفه أولًا من صفحة المخزن ثم اختره هنا.");
    if (!Number.isInteger(quantity) || quantity <= 0) return toast.error("أدخل كمية صحيحة أكبر من صفر.");
    const alreadySelected = form.firstVisitItems.find(item => item.inventoryItemId === catalogItem.id)?.quantity ?? 0;
    if (catalogItem.currentBalance !== undefined && alreadySelected + quantity > catalogItem.currentBalance) return toast.error(`الرصيد المتاح من ${catalogItem.name}: ${catalogItem.currentBalance}`);
    setForm(current => {
      const existing = current.firstVisitItems.find(item => item.inventoryItemId === catalogItem.id);
      const firstVisitItems = existing
        ? current.firstVisitItems.map(item => item.inventoryItemId === catalogItem.id ? { ...item, quantity: item.quantity + quantity, source: "manual" as const } : item)
        : [...current.firstVisitItems, { inventoryItemId: catalogItem.id, quantity, source: "manual" as const }];
      return { ...current, firstVisitItems };
    });
    setFirstManualItemName(""); setFirstManualItemQuantity("1");
  }
  function addManualVisitItem() {
    const name = manualItemName.trim();
    const catalogItem = effectiveServiceCatalog?.items.find(item => item.name.trim() === name);
    const quantity = Number.parseInt(manualItemQuantity, 10);
    if (!catalogItem) return toast.error("الصنف غير موجود في المخزن؛ أضفه أولًا من صفحة المخزن ثم اختره هنا.");
    if (!Number.isInteger(quantity) || quantity <= 0) return toast.error("أدخل كمية صحيحة أكبر من صفر.");
    const alreadySelected = visitItems.find(item => item.inventoryItemId === catalogItem.id)?.quantity ?? 0;
    if (catalogItem.currentBalance !== undefined && alreadySelected + quantity > catalogItem.currentBalance) return toast.error(`الرصيد المتاح من ${catalogItem.name}: ${catalogItem.currentBalance}`);
    setVisitItems(current => addOrIncrementVisitItem(current, catalogItem, quantity));
    setManualItemName(""); setManualItemQuantity("1");
  }
  function submitVisit(event: FormEvent) {
    event.preventDefault();
    if (!visitCustomer) return;
    const collectedAmount = Math.round(Number.parseFloat(visitCollectedAmount) || 0);
    const payload = { customerId: visitCustomer.id, phone: visitCustomer.phone || undefined, visitType, visitDate: new Date(visitDate), technicianName: visitTechnicianName || null, assignedTechnicianId: visitTechnicianId ? Number(visitTechnicianId) : null, salesAgentName: visitSalesAgentName || null, filterCount: Math.max(1, Math.floor(Number(visitFilterCount) || 1)), tdsIn: visitTdsIn.trim() ? Math.round(Number(visitTdsIn)) : null, tdsOut: visitTdsOut.trim() ? Math.round(Number(visitTdsOut)) : null, visitResult: visitResult || null, collectedAmount, notes: visitNotes || null, items: visitItems.filter(item => item.quantity > 0) };
    if (payload.items.length > 0) {
      const confirmed = window.confirm(buildPartsConfirmation(payload.items, effectiveServiceCatalog?.items ?? []));
      if (!confirmed) return;
    }
    if (isOffline) {
      toast.error("تسجيل الزيارة يحتاج اتصالًا مباشرًا بالسيرفر المركزي.");
      return;
    }
    createVisit.mutate(payload);
  }
  function openEdit(customer: NonNullable<typeof customers>[number]) { const serviceDate = customer.followUp?.lastServiceVisitDate ? new Date(customer.followUp.lastServiceVisitDate) : new Date(); serviceDate.setMinutes(serviceDate.getMinutes() - serviceDate.getTimezoneOffset()); const location = customer.latitude && customer.longitude ? `${customer.latitude}, ${customer.longitude}` : ""; setForm({ ...emptyCustomer, id: customer.id, manualCode: customer.manualCode || "", name: customer.name, phone: customer.phone, address: customer.address || "", location, notes: customer.notes || "", firstVisitDate: serviceDate.toISOString().slice(0, 16) }); setDialogOpen(true); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const location = parseLocation(form.location);
    const payload = { manualCode: form.manualCode.trim() || null, name: form.name, phone: form.phone, address: form.address || null, latitude: location.latitude, longitude: location.longitude, notes: form.notes || null, ...(form.id ? {} : { firstVisitType: form.firstVisitType, firstVisitDate: new Date(form.firstVisitDate), firstTechnicianName: form.firstTechnicianName || null, firstTechnicianId: form.firstTechnicianId ? Number(form.firstTechnicianId) : null, firstSalesAgentName: form.firstSalesAgentName || null, firstFilterCount: Math.max(1, Math.floor(Number(form.firstFilterCount) || 1)), firstTdsIn: form.firstTdsIn.trim() ? Math.round(Number(form.firstTdsIn)) : null, firstTdsOut: form.firstTdsOut.trim() ? Math.round(Number(form.firstTdsOut)) : null, firstVisitResult: form.firstVisitResult || null, firstVisitNotes: form.firstVisitNotes || null, firstCollectedAmount: Math.round(Number(form.firstCollectedAmount || 0)), firstCollectedCurrency: "SAR" as const, items: form.firstVisitItems.filter(item => item.quantity > 0) }) };
    if (form.id) {
      if (isOffline) return toast.error("تعديل البيانات يحتاج اتصالًا بالإنترنت حاليًا.");
      setPendingUpdate({ id: form.id, manualCode: form.manualCode.trim() || null, name: form.name, phone: form.phone, address: form.address || null, latitude: location.latitude, longitude: location.longitude, notes: form.notes || null, serviceDate: new Date(form.firstVisitDate), ...(form.firstCollectedAmount.trim() ? { collectedAmount: Math.round(Number(form.firstCollectedAmount)) } : {}) });
      setPinOpen(true);
      return;
    }
    if (isOffline) {
      toast.error("إضافة العميل تحتاج اتصالًا مباشرًا بالسيرفر المركزي.");
      return;
    }
    createCustomer.mutate(payload);
  }
  async function handleCustomerImport(file?: File, requestedSheetName?: string) {
    if (!file) return;
    setImportFile(file); setImportFileName(file.name); setImportMessage("");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    try {
      if (isPdf) {
        const parsed = await parseCustomerPdf(file);
        setImportSheetNames([]); setImportSheetName(""); setImportRows(parsed.rows); setImportIssues(parsed.issues);
        if (!parsed.rows.length) toast.error(parsed.issues[0]?.reason || "لم نجد صفوفًا صالحة في ملف PDF");
        else toast.success(`تمت قراءة ${parsed.rows.length} صفًا من ملف PDF؛ راجع المعاينة قبل الحفظ`);
        return;
      }
      const parsed = await parseCustomerExcel(file, requestedSheetName);
      setImportSheetNames(parsed.sheetNames);
      setImportSheetName(parsed.selectedSheetName ?? "");
      setImportRows(parsed.rows); setImportIssues(parsed.issues);
      if (!parsed.rows.length) toast.error(parsed.issues[0]?.reason || "لم نجد صفوفًا صالحة في الملف");
      else toast.success(`تمت قراءة ${parsed.rows.length} صفًا من ورقة «${parsed.selectedSheetName}»؛ راجع المعاينة قبل الحفظ`);
    } catch {
      setImportRows([]); setImportSheetNames([]); setImportSheetName(""); setImportIssues([{ rowNumber: 1, reason: isPdf ? "تعذر قراءة ملف PDF. إذا كان مصورًا أو ممسوحًا ضوئيًا فحوّله إلى PDF نصي أو Excel." : "تعذر قراءة الملف. استخدم ملف xlsx أو xls صحيحًا." }]); toast.error(isPdf ? "تعذر قراءة ملف PDF" : "تعذر قراءة ملف Excel");
    }
  }
  function applyPastedCustomers() {
    const parsed = parseCustomerClipboard(pasteText);
    setImportFile(null); setImportFileName("بيانات منسوخة من Excel"); setImportSheetNames([]); setImportSheetName(""); setImportRows(parsed.rows); setImportIssues(parsed.issues);
    if (!parsed.rows.length) toast.error(parsed.issues[0]?.reason || "لم نجد صفوفًا صالحة في البيانات الملصقة");
    else toast.success(`تمت قراءة ${parsed.rows.length} صفًا من البيانات الملصقة؛ راجع المعاينة قبل الحفظ`);
  }
  function submitCustomerImport() { if (!importRows.length || importCustomers.isPending) return; importCustomers.mutate({ rows: importRows }); }
  function resetCustomerImport() { setImportRows([]); setImportIssues([]); setImportFileName(""); setImportFile(null); setImportSheetNames([]); setImportSheetName(""); setImportMessage(""); setPasteText(""); }
  function exportCustomers() { if (!displayedCustomers?.length) { toast.info("لا توجد بيانات مطابقة للتصدير"); return; } downloadRowsAsExcel(`عملاء-نقطة-نقاء-${new Date().toISOString().slice(0, 10)}.xlsx`, "العملاء", withArabicHeaders(customerRowsForExcel(displayedCustomers), customerExcelHeaders)); toast.success("تم تجهيز ملف العملاء للتنزيل"); }
  function exportCustomersPdf() { if (!displayedCustomers?.length) { toast.info("لا توجد بيانات مطابقة للتصدير"); return; } const rows = customerRowsForExcel(displayedCustomers); const opened = printArabicPdf("تقرير العملاء", rows, Object.entries(customerExcelHeaders).map(([key, label]) => ({ key, label }))); if (opened) toast.success("تم فتح تقرير PDF للطباعة أو الحفظ"); else toast.error("تعذر فتح نافذة PDF. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى"); }

  return (
    <div className="mx-auto -mt-2 w-full max-w-none space-y-4 px-0 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-0 lg:-mx-8 lg:w-[calc(100%+4rem)]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="page-heading">إدارة العملاء</h1><p className="page-subheading">احتفظ ببيانات العملاء ومواقعهم وسجل خدماتهم بصورة مرتبة.</p></div><div className="flex flex-wrap gap-2"><div className="inline-flex items-center rounded-xl border border-teal-200 bg-teal-50 p-1" role="group" aria-label="طريقة عرض العملاء"><Button type="button" variant="ghost" className={`h-9 rounded-lg px-3 text-xs font-extrabold ${customerView === "cards" ? "bg-white text-teal-800 shadow-sm" : "text-teal-700"}`} onClick={() => setCustomerView("cards")} aria-pressed={customerView === "cards"} data-testid="customer-view-cards-button"><LayoutGrid className="ml-1.5 h-4 w-4" />البطاقات</Button><Button type="button" variant="ghost" className={`h-9 rounded-lg px-3 text-xs font-extrabold ${customerView === "table" ? "bg-white text-teal-800 shadow-sm" : "text-teal-700"}`} onClick={() => setCustomerView("table")} aria-pressed={customerView === "table"} data-testid="customer-view-table-button"><Table2 className="ml-1.5 h-4 w-4" />الجدول</Button></div><Button type="button" variant="outline" className="h-11 rounded-xl md:hidden" onClick={() => { const next = !compactMobile; setCompactMobile(next); saveAppSettings({ compactCustomersOnMobile: next }); }} aria-pressed={compactMobile}>{compactMobile ? "العرض الكامل" : "عرض مبسط"}</Button><Button onClick={() => setImportOpen(true)} variant="outline" className="h-11 rounded-xl border-teal-200 font-bold text-teal-800"><Upload className="ml-2 h-4 w-4" />استيراد Excel أو PDF</Button><Button onClick={downloadCustomerImportTemplate} variant="ghost" className="h-11 rounded-xl text-teal-700"><FileSpreadsheet className="ml-2 h-4 w-4" />قالب Excel</Button><Button onClick={exportCustomers} variant="outline" className="h-11 rounded-xl"><Download className="ml-2 h-4 w-4" />تصدير Excel</Button><Button onClick={exportCustomersPdf} variant="outline" className="h-11 rounded-xl"><Download className="ml-2 h-4 w-4" />تصدير PDF</Button><Button onClick={() => setVisitPickerOpen(true)} variant="outline" className="h-11 rounded-xl border-teal-200 font-bold text-teal-800"><Plus className="ml-2 h-5 w-5" />تسجيل زيارة</Button><Button onClick={openNew} className="h-11 rounded-xl bg-teal-700 px-5 font-bold hover:bg-teal-800"><Plus className="ml-2 h-5 w-5" />إضافة عميل</Button></div></div>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="بطاقات حالات متابعة العملاء">
        {([
          { key: "overdue" as const, title: "متأخر", description: "تجاوز موعد المتابعة", count: statusCards.overdue, cardClass: "border-rose-200 bg-rose-50/85", iconClass: "bg-rose-600 text-white", countClass: "bg-rose-100 text-rose-800", icon: AlertCircle },
          { key: "today" as const, title: "اليوم", description: "موعده خلال اليوم", count: statusCards.today, cardClass: "border-red-200 bg-red-50/85", iconClass: "bg-red-500 text-white", countClass: "bg-red-100 text-red-800", icon: CalendarDays },
          { key: "within_5_days" as const, title: "خلال ٥ أيام", description: "موعد قريب للمتابعة", count: statusCards.within_5_days, cardClass: "border-orange-200 bg-orange-50/85", iconClass: "bg-orange-500 text-white", countClass: "bg-orange-100 text-orange-800", icon: Clock3 },
          { key: "more_than_5_days" as const, title: "منتظم", description: "لا توجد متابعة مستحقة", count: statusCards.more_than_5_days, cardClass: "border-emerald-200 bg-emerald-50/85", iconClass: "bg-emerald-600 text-white", countClass: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
          { key: "none" as const, title: "بدون موعد", description: "لم يُحدد موعد قادم", count: statusCards.none, cardClass: "border-slate-200 bg-slate-50/90", iconClass: "bg-slate-500 text-white", countClass: "bg-slate-100 text-slate-700", icon: CircleHelp },
        ]).map(card => { const Icon = card.icon; const active = followUpStatus === card.key; return <button key={card.key} type="button" data-testid={`customer-status-card-${card.key}`} onClick={() => setFollowUpStatus(card.key)} className={`soft-card flex min-h-28 items-center gap-3 border-2 p-4 text-right transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${card.cardClass} ${active ? "ring-2 ring-teal-600 ring-offset-2" : ""}`} aria-label={`عرض ${card.title}`} aria-pressed={active}>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ${card.iconClass}`}><Icon className="h-5 w-5" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-base font-extrabold leading-6 text-slate-950">{card.title}</span><span className={`rounded-full px-2.5 py-1 text-sm font-extrabold ${card.countClass}`}>{card.count}</span></span><span className="mt-1 block truncate text-xs font-bold leading-5 text-slate-700">{card.description}</span></span>
        </button>; })}
      </section>
      <div className="soft-card overflow-hidden"><div className="border-b border-teal-950/6 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="field-input pr-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم العميل أو هاتفه أو كوده" aria-label="البحث في العملاء" /></div><div className="flex flex-wrap items-center gap-1.5" aria-label="فلاتر حالات العملاء"><button type="button" onClick={() => setFollowUpStatus("all")} className={`min-w-[58px] rounded-lg border px-2 py-1.5 text-[11px] font-extrabold transition ${followUpStatus === "all" ? "border-slate-600 bg-slate-200 text-slate-950 ring-2 ring-slate-400 ring-offset-1 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} data-testid="customer-filter-all" aria-label="فلترة حالة العميل: الكل" aria-pressed={followUpStatus === "all"}>الكل <span className="mr-1">{statusCards.all}</span></button><button type="button" onClick={() => setFollowUpStatus("overdue")} className={`min-w-[62px] rounded-lg border px-2 py-1.5 text-[11px] font-extrabold transition ${followUpStatus === "overdue" ? "border-rose-600 bg-rose-200 text-rose-950 ring-2 ring-rose-400 ring-offset-1 shadow-sm" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`} data-testid="customer-filter-overdue" aria-label="فلترة حالة العميل: متأخر" aria-pressed={followUpStatus === "overdue"}>متأخر <span className="mr-1">{statusCards.overdue}</span></button><button type="button" onClick={() => setFollowUpStatus("today")} className={`min-w-[58px] rounded-lg border px-2 py-1.5 text-[11px] font-extrabold transition ${followUpStatus === "today" ? "border-amber-600 bg-amber-200 text-amber-950 ring-2 ring-amber-400 ring-offset-1 shadow-sm" : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}`} data-testid="customer-filter-today" aria-label="فلترة حالة العميل: اليوم" aria-pressed={followUpStatus === "today"}>اليوم <span className="mr-1">{statusCards.today}</span></button><button type="button" onClick={() => setFollowUpStatus("within_5_days")} className={`min-w-[92px] rounded-lg border px-2 py-1.5 text-[11px] font-extrabold transition ${followUpStatus === "within_5_days" ? "border-orange-600 bg-orange-200 text-orange-950 ring-2 ring-orange-400 ring-offset-1 shadow-sm" : "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100"}`} data-testid="customer-filter-within-5-days" aria-label="فلترة حالة العميل: خلال ٥ أيام" aria-pressed={followUpStatus === "within_5_days"}>خلال ٥ أيام <span className="mr-1">{statusCards.within_5_days}</span></button><button type="button" onClick={() => setFollowUpStatus("more_than_5_days")} className={`min-w-[92px] rounded-lg border px-2 py-1.5 text-[11px] font-extrabold transition ${followUpStatus === "more_than_5_days" ? "border-emerald-600 bg-emerald-200 text-emerald-950 ring-2 ring-emerald-400 ring-offset-1 shadow-sm" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`} data-testid="customer-filter-more-than-5-days" aria-label="فلترة حالة العميل: أكثر من ٥ أيام" aria-pressed={followUpStatus === "more_than_5_days"}>أكثر من ٥ أيام <span className="mr-1">{statusCards.more_than_5_days}</span></button></div><label className="flex items-center gap-2 text-xs font-bold text-teal-900"><span className="whitespace-nowrap">ترتيب</span><select className="field-input min-w-40" value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)} aria-label="ترتيب العملاء"><option value="created_desc">الأحدث إضافة</option><option value="next_asc">أقرب متابعة</option><option value="status">الأولوية</option><option value="collected_desc">الأعلى تحصيلًا</option><option value="collected_asc">الأقل تحصيلًا</option></select></label><Button type="button" variant="outline" className="rounded-xl" onClick={() => { setSearch(""); setFollowUpStatus("all"); setSortBy("created_desc"); }}>مسح</Button></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">ابحث بسرعة، ثم اختر الحالة التي تريد متابعتها اليوم.</span><span className="rounded-full bg-teal-100 px-3 py-1.5 font-extrabold text-teal-900" aria-live="polite">{activeFilterLabel}: {displayedCustomers?.length ?? 0}</span></div></div>
        {isError && displayedCustomers ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">تعذر الوصول إلى الخادم حاليًا؛ تُعرض آخر قائمة عملاء محفوظة على هذا الجهاز، وستتزامن التغييرات عند عودة الاتصال.</div> : null}<div className="max-h-[calc(100vh-18rem)] overflow-auto"><div data-testid="customer-view-cards" className={customerView === "cards" ? "block" : "hidden"}><div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">{isLoading && !displayedCustomers ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>  : renderedCustomers?.length ? renderedCustomers.map(customer => { const followUp = customer.followUp; const tone = customerCardTone(getCustomerCardStatus(followUp?.daysRemaining)); return <article key={`mobile-${customer.id}`} data-testid={`customer-card-${customer.id}`} className={`rounded-2xl border-2 p-3 shadow-sm ${tone.card}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><button type="button" onClick={() => setLocation(`/customers/${customer.id}`)} className={`block max-w-full break-words text-right text-base font-extrabold leading-6 ${tone.accent}`}>{customer.name}</button><p className={`mt-1 text-sm font-bold tracking-wide ${tone.muted}`} dir="ltr">{customer.customerCode} · {customer.phone}</p></div>{followUp ? <Badge className={`border ${tone.badge} font-extrabold`}>{followUp.daysRemaining < 0 ? "متأخر" : followUp.daysRemaining <= 7 ? "خلال ٧ أيام" : "منتظم"}</Badge> : <Badge className={`border ${tone.badge} font-extrabold`}>بدون موعد</Badge>}</div>{!compactMobile && <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div className={`rounded-xl p-2 ${tone.panel}`}><span className={`block font-bold ${tone.muted}`}>المتابعة القادمة</span><strong className={`mt-1 block font-extrabold ${tone.accent}`}>{followUp ? formatDateTime(followUp.nextVisitDate) : "لا يوجد موعد"}</strong></div><div className={`rounded-xl p-2 ${tone.panel}`}><span className={`block font-bold ${tone.muted}`}>إجمالي المحصل</span><strong className={`mt-1 block font-extrabold ${tone.accent}`}>{customer.totalCollectedAmount > 0 ? formatAppMoney(customer.totalCollectedAmount) : "—"}</strong></div><div className="mt-2 rounded-xl bg-sky-50 px-2 py-2 text-xs font-extrabold text-sky-800">آخر قياس TDS: دخول {customer.latestTdsIn ?? "—"} ppm · خروج {customer.latestTdsOut ?? "—"} ppm</div></div>}<div className="mt-3 flex flex-wrap gap-2"><CustomerContactActions customer={customer} companyWhatsAppPhone={notificationSettings?.companyWhatsAppPhone} compact labels showLocationPlaceholder /><button onClick={() => openVisit(customer)} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-teal-100 px-3 text-xs font-extrabold text-teal-800"><Plus className="h-3.5 w-3.5" />زيارة</button><button onClick={() => openEdit(customer)} className="inline-flex min-h-10 items-center rounded-xl bg-amber-50 px-3 text-xs font-extrabold text-amber-700">تعديل</button><button onClick={() => setDeleteId(customer.id)} className="inline-flex min-h-10 items-center rounded-xl bg-rose-50 px-3 text-xs font-extrabold text-rose-700">حذف</button></div></article>; }) : <div className="p-8 text-center text-sm text-muted-foreground">لا توجد بيانات عملاء مطابقة.</div>}</div>{displayedCustomers && displayedCustomers.length > visibleCount ? <div className="flex items-center justify-center border-t border-teal-100 px-3 py-3"><Button type="button" variant="outline" className="h-10 rounded-xl border-teal-200 font-bold text-teal-800" onClick={() => setVisibleCount(count => Math.min(count + 100, displayedCustomers.length))}>تحميل المزيد ({displayedCustomers.length - visibleCount})</Button></div> : null}</div><div data-testid="customer-view-table" className={customerView === "table" ? "block min-w-0" : "hidden"}><table className="w-full min-w-[560px] table-fixed border border-teal-200/80 text-right text-[13px] sm:text-sm md:min-w-[1040px] [&_td]:border [&_td]:border-teal-100 [&_th]:border [&_th]:border-teal-200/80"><colgroup><col className="w-[160px]" /><col className="w-[102px]" /><col className="w-[145px]" /><col className="w-[115px]" /><col className="w-[92px]" /><col className="w-[92px]" /><col className="w-[105px]" /><col className="w-[140px]" /><col className="w-[190px]" /></colgroup><thead className="sticky top-0 z-10 bg-teal-50 text-xs text-teal-950/65 shadow-[0_2px_8px_rgba(15,118,110,0.08)]"><tr><th className="sticky top-0 z-10 whitespace-nowrap bg-teal-50 px-4 py-3 font-bold">العميل</th><th className="sticky top-0 z-10 whitespace-nowrap bg-teal-50 px-2 py-2 font-bold">الهاتف</th><th className="sticky top-0 z-10 whitespace-nowrap bg-teal-50 px-4 py-3 font-bold">المتابعة القادمة</th><th className="sticky top-0 z-10 hidden bg-teal-50 px-3 py-2 font-bold md:table-cell">آخر زيارة</th><th className="sticky top-0 z-10 hidden whitespace-nowrap bg-teal-50 px-2 py-2 font-bold md:table-cell">الفني</th><th className="sticky top-0 z-10 hidden whitespace-nowrap bg-teal-50 px-2 py-2 font-bold md:table-cell">آخر تحصيل</th><th className="sticky top-0 z-10 hidden whitespace-nowrap bg-teal-50 px-2 py-2 font-bold md:table-cell">إجمالي المحصل</th><th className="sticky top-0 z-10 hidden bg-teal-50 px-3 py-2 font-bold md:table-cell">العنوان</th><th className="sticky top-0 z-10 bg-teal-50 px-3 py-2 font-bold">إجراءات</th></tr></thead><tbody className="divide-y divide-teal-950/6">{isLoading && !displayedCustomers ? <tr><td colSpan={9} className="p-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>  : renderedCustomers?.length ? renderedCustomers.map(customer => { const followUp = customer.followUp; return <tr key={customer.id}
 className="h-14 align-middle hover:bg-teal-50/45"><td className="px-2 py-1"><div className="flex items-start gap-1.5"><button type="button" onClick={event => { event.stopPropagation(); if (!followUp) return; setFollowUpStatus(followUp.daysRemaining < 0 ? "overdue" : followUp.daysRemaining === 0 ? "today" : followUp.daysRemaining <= 5 ? "within_5_days" : "more_than_5_days"); }} className={`mt-0.5 inline-flex shrink-0 items-center rounded-full transition ${followUp ? "cursor-pointer hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500" : "cursor-default"}`} title={followUp ? "اضغط لفلترة العملاء حسب هذه الحالة" : "لا توجد متابعة مسجلة"} aria-label={followUp ? `حالة متابعة العميل: ${followUp.daysRemaining < 0 ? "متأخر" : followUp.daysRemaining === 0 ? "اليوم" : followUp.daysRemaining <= 5 ? "خلال ٥ أيام" : "أكثر من ٥ أيام"}` : "لا توجد متابعة مسجلة"}>{followUp && followUp.daysRemaining < 0 ? <AlertCircle className="h-4 w-4 text-rose-600" /> : followUp && followUp.daysRemaining <= 5 ? <Clock3 className="h-4 w-4 text-amber-600" /> : followUp ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}</button><button type="button" onClick={() => setLocation(`/customers/${customer.id}`)} className="min-w-0 flex-1 whitespace-normal break-words text-right font-extrabold leading-5 text-teal-900 hover:text-teal-600" title={customer.name}><span>{customer.name}</span></button></div><p className="mt-0.5 text-xs font-bold tracking-wide text-teal-700" dir="ltr">{customer.customerCode}</p></td><td className="whitespace-nowrap px-2 py-1 text-sm" dir="ltr">{customer.phone}</td><td className="px-3 py-1 text-sm">{followUp ? <><p className="font-bold text-teal-950">{formatDateTime(followUp.nextVisitDate)}</p><p className={`mt-0.5 text-xs font-bold ${followUp.daysRemaining < 0 ? "text-rose-700" : "text-teal-700"}`}>{followUp.daysRemaining < 0 ? `متأخر ${Math.abs(followUp.daysRemaining)} يوم` : followUp.daysRemaining === 0 ? "موعده اليوم" : `متبقي ${followUp.daysRemaining} يوم`}</p>{(() => { const badge = followUpBadge(followUp.daysRemaining); return <Badge className={`mt-1 ${badge.className}`} aria-label={badge.ariaLabel}>{badge.label}</Badge>; })()}</> : <span className="text-muted-foreground">لا يوجد موعد</span>}</td><td className="hidden px-3 py-1 text-sm md:table-cell">{customer.lastVisitDate && customer.lastVisitDate.getTime() > 0 ? formatDateTime(customer.lastVisitDate) : "—"}<span className="mt-1 block text-xs font-bold text-sky-700">TDS {customer.latestTdsIn ?? "—"} / {customer.latestTdsOut ?? "—"} ppm</span></td><td className="hidden whitespace-nowrap px-2 py-1 text-sm font-bold text-teal-900 md:table-cell">{customer.latestTechnicianName || "—"}</td><td className="hidden whitespace-nowrap px-2 py-1 text-sm font-bold text-teal-800 md:table-cell">{customer.collectedAmount && customer.collectedAmount > 0 ? `${formatAppMoney(customer.collectedAmount)}` : "—"}</td><td className="hidden whitespace-nowrap px-2 py-1 text-sm font-extrabold text-emerald-700 md:table-cell">{customer.totalCollectedAmount > 0 ? formatAppMoney(customer.totalCollectedAmount) : "—"}</td><td className="hidden max-w-64 truncate px-3 py-1 text-sm text-muted-foreground md:table-cell">{customer.address || "—"}</td><td className="px-3 py-1"><div className="flex flex-wrap items-center gap-2"><CustomerContactActions customer={customer} companyWhatsAppPhone={notificationSettings?.companyWhatsAppPhone} compact labels showLocationPlaceholder /><button onClick={() => openVisit(customer)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-teal-100 px-2.5 text-xs font-extrabold text-teal-800 hover:bg-teal-200" title="تسجيل زيارة جديدة"><Plus className="h-3.5 w-3.5" />زيارة</button><button onClick={() => setLocation(`/customers/${customer.id}`)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-sky-50 px-2.5 text-xs font-extrabold text-sky-800 hover:bg-sky-100" title="فتح سجل الزيارات">السجل</button><button onClick={() => openEdit(customer)} className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100" title="تعديل"><Pencil className="h-4 w-4" /></button><button onClick={() => setDeleteId(customer.id)} className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100" title="حذف">حذف</button></div></td></tr>; }) : <tr><td colSpan={9} className="p-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-teal-200" /><p className="mt-3 text-sm text-muted-foreground">لا توجد بيانات عملاء مطابقة.</p></td></tr>}</tbody></table></div></div>
      </div>
      <Dialog open={dialogOpen} onOpenChange={handleCustomerDialogOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl"><DialogHeader><DialogTitle>{form.id ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</DialogTitle><DialogDescription>أدخل بيانات العميل والخدمة الأولى، ثم احفظها لتحديث الزيارات والتذكيرات والخزينة تلقائيًا.</DialogDescription></DialogHeader><form onSubmit={submit} className="grid gap-4 py-2 sm:grid-cols-2"><div className="rounded-xl border border-teal-100 bg-teal-50/50 px-4 py-3 sm:col-span-2"><span className="field-label">كود العميل</span><p className="mt-1 text-lg font-extrabold tracking-wide text-teal-900" dir="ltr">{form.id ? (customers?.find(customer => customer.id === form.id)?.customerCode || "—") : "سيُنشأ تلقائيًا بعد الحفظ"}</p><p className="mt-1 text-xs text-teal-700">يمكنك إدخال الكود يدويًا، وإذا تركته فارغًا يُنشئه النظام تلقائيًا بالتسلسل.</p></div><div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="كود العميل (اختياري)" value={form.manualCode} onChange={value => setForm({ ...form, manualCode: value })} dir="ltr" placeholder="مثال: ١٠٠ أو 100" /></div><button type="button" className="mb-0 h-10 shrink-0 rounded-xl border border-teal-200 bg-white px-3 text-xs font-bold text-teal-800 transition hover:bg-teal-50" onClick={() => setForm({ ...form, manualCode: "" })}>تلقائي</button></div><Field label="اسم العميل" value={form.name} onChange={value => setForm({ ...form, name: value })} required /><Field label="رقم الهاتف" value={form.phone} onChange={value => setForm({ ...form, phone: value })} dir="ltr" required /><div className="sm:col-span-2"><Field label="العنوان" value={form.address} onChange={value => setForm({ ...form, address: value })} /></div><div className="sm:col-span-2 mt-2 rounded-2xl border border-teal-100 bg-teal-50/60 p-4"><p className="mb-3 text-sm font-extrabold text-teal-900">بيانات أول خدمة والتحصيل</p><div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">نوع أمر الخدمة</span><select className="field-input" value={form.firstVisitType} disabled={Boolean(form.id)} onChange={event => { const firstVisitType = event.target.value as VisitType; setForm({ ...form, firstVisitType, firstVisitItems: getDefaultVisitItems(firstVisitType) }); }}><option value="installation">تركيب فلتر</option><option value="maintenance">صيانة</option><option value="cartridge_change">تغيير شمعات</option><option value="follow_up">متابعة</option><option value="other">أخرى</option></select></label><label><span className="field-label">اسم الفني</span><select aria-label="اسم الفني لأول خدمة" className="field-input" value={form.firstTechnicianId} onChange={event => { const id = event.target.value; const technician = visibleTechnicians.find(item => String(item.id) === id); setForm({ ...form, firstTechnicianId: id, firstTechnicianName: technician?.name ?? "" }); }}><option value="">اختر الفني</option>{visibleTechnicians.map(technician => <option key={technician.id} value={String(technician.id)}>{technician.name ?? "فني بدون اسم"}</option>)}</select></label><label><span className="field-label">متابع عملاء</span><select aria-label="متابع عملاء للزيارة الأولى" className="field-input" value={form.firstSalesAgentName} onChange={event => setForm({ ...form, firstSalesAgentName: event.target.value })}><option value="">اختر المتابع</option>{salesAgentNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label><span className="field-label">عدد الفلاتر</span><input type="number" min="1" step="1" className="field-input" value={form.firstFilterCount} onChange={event => setForm({ ...form, firstFilterCount: event.target.value })} /></label><label><span className="field-label">قياس المياه قبل الفلتر (TDS In)</span><input aria-label="قياس المياه قبل الفلتر للعميل الجديد" type="number" min="0" step="1" inputMode="numeric" className="field-input" value={form.firstTdsIn} onChange={event => setForm({ ...form, firstTdsIn: event.target.value })} placeholder="اختياري - ppm" /></label><label><span className="field-label">قياس المياه بعد الفلتر (TDS Out)</span><input aria-label="قياس المياه بعد الفلتر للعميل الجديد" type="number" min="0" step="1" inputMode="numeric" className="field-input" value={form.firstTdsOut} onChange={event => setForm({ ...form, firstTdsOut: event.target.value })} placeholder="اختياري - ppm" /></label><label><span className="field-label">قياس المياه قبل الفلتر (TDS In)</span><input aria-label="قياس المياه قبل الفلتر للعميل الجديد" type="number" min="0" step="1" inputMode="numeric" className="field-input" value={form.firstTdsIn} onChange={event => setForm({ ...form, firstTdsIn: event.target.value })} placeholder="اختياري - ppm" /></label><label><span className="field-label">قياس المياه بعد الفلتر (TDS Out)</span><input aria-label="قياس المياه بعد الفلتر للعميل الجديد" type="number" min="0" step="1" inputMode="numeric" className="field-input" value={form.firstTdsOut} onChange={event => setForm({ ...form, firstTdsOut: event.target.value })} placeholder="اختياري - ppm" /></label><label><span className="field-label">نتيجة الزيارة</span><textarea className="field-textarea min-h-20" value={form.firstVisitResult} onChange={event => setForm({ ...form, firstVisitResult: event.target.value })} placeholder="ما الذي تم تنفيذه؟" /></label><label><span className="field-label">تاريخ ووقت الخدمة</span><input type="datetime-local" className="field-input" value={form.firstVisitDate} onChange={event => setForm({ ...form, firstVisitDate: event.target.value })} /></label><label><span className="field-label">المبلغ المحصل</span><input type="number" min="0" step="1" className="field-input" value={form.firstCollectedAmount} onChange={event => setForm({ ...form, firstCollectedAmount: event.target.value })} placeholder="مثال: 250" /></label></div><p className="mt-3 text-xs text-teal-800">سيُنشئ النظام الزيارة وسجل التحصيل في الخزينة تلقائيًا، وسيضيف تذكيرًا بعد 120 يومًا للتركيب أو الصيانة. عند التعديل، يُحدّث تاريخ آخر خدمة وموعد المتابعة المرتبط بها.</p><UsedItemsSection items={form.firstVisitItems} setItems={items => setForm(current => ({ ...current, firstVisitItems: typeof items === "function" ? items(current.firstVisitItems) : items }))} catalogItems={effectiveServiceCatalog?.items ?? []} manualName={firstManualItemName} setManualName={setFirstManualItemName} manualQuantity={firstManualItemQuantity} setManualQuantity={setFirstManualItemQuantity} onAdd={addManualFirstVisitItem} onQuickAdd={item => setForm(current => ({ ...current, firstVisitItems: addOrIncrementVisitItem(current.firstVisitItems, item) }))} listId="first-visit-inventory-items" /></div><div className="sm:col-span-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3"><div className="min-w-0 flex-1"><Field label="الموقع" value={form.location} onChange={value => setForm({ ...form, location: value })} dir="ltr" placeholder="رابط Google Maps أو الإحداثيات" /></div><Button type="button" variant="outline" className="h-11 shrink-0 rounded-xl border-teal-300 bg-teal-50 font-extrabold text-teal-800 hover:bg-teal-100" onClick={pasteWhatsAppLocation}>لصق موقع واتساب</Button></div><p className="mt-1 text-xs text-muted-foreground">الصق رابط الموقع الذي وصلك في واتساب؛ سيستخرج التطبيق الإحداثيات تلقائيًا عندما تكون موجودة داخل الرابط.</p>{locationPreview.latitude && locationPreview.longitude && <div className="mt-3 overflow-hidden rounded-2xl border border-teal-100 bg-teal-50/40"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 px-3 py-2"><p className="text-sm font-extrabold text-teal-950">معاينة موقع العميل</p><a href={`https://www.google.com/maps?q=${locationPreview.latitude},${locationPreview.longitude}`} target="_blank" rel="noreferrer" className="text-xs font-extrabold text-teal-700 underline underline-offset-2">فتح الخريطة</a></div>{isOffline ? <div className="p-3 text-xs font-bold text-amber-800">الخريطة المصغرة تحتاج اتصالًا مؤقتًا، لكن الإحداثيات والرابط سيبقيان محفوظين للعمل دون اتصال.</div> : <MapView className="h-[190px] w-full" initialCenter={{ lat: Number(locationPreview.latitude), lng: Number(locationPreview.longitude) }} initialZoom={16} onMapReady={map => { new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: Number(locationPreview.latitude), lng: Number(locationPreview.longitude) }, title: "موقع العميل" }); }} />}</div>}</div><div className="sm:col-span-2"><label className="field-label">ملاحظات</label><textarea className="field-textarea" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="أي ملاحظات مفيدة للفني" /></div><div className="flex justify-end gap-3 pt-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">إلغاء</Button><Button disabled={saving} type="submit" className="rounded-xl bg-teal-700 hover:bg-teal-800">{saving ? "جارٍ الحفظ…" : "حفظ البيانات"}</Button></div></form></DialogContent>      </Dialog>
      <Dialog open={visitPickerOpen} onOpenChange={handleVisitPickerOpenChange}><DialogContent dir="rtl" className="sm:max-w-lg"><DialogHeader><DialogTitle>تسجيل زيارة جديدة</DialogTitle><DialogDescription>اختر العميل لفتح بطاقة التسجيل وإضافة الفني والمبلغ المحصل.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><label><span className="field-label">بحث عن العميل</span><div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="field-input pr-9" placeholder="اكتب الاسم أو الهاتف أو كود العميل" value={visitPickerSearch} onChange={event => setVisitPickerSearch(event.target.value)} autoFocus /></div></label><div><span className="field-label">العميل</span><div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-teal-100 bg-teal-50/40 p-2" role="listbox" aria-label="نتائج البحث عن العميل">{displayedCustomers?.filter(customer => { const query = visitPickerSearch.trim().toLowerCase(); if (!query) return true; return [customer.name, customer.phone, customer.customerCode ?? ""].some(value => value.toLowerCase().includes(query)); }).slice(0, 50).map(customer => <button key={customer.id} type="button" role="option" aria-selected={String(customer.id) === visitPickerCustomerId} onClick={() => { setVisitPickerCustomerId(String(customer.id)); chooseVisitCustomer(customer.id); }} className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${String(customer.id) === visitPickerCustomerId ? "border-teal-600 bg-teal-100" : "border-transparent bg-white hover:border-teal-300 hover:bg-teal-50"}`}><span className="min-w-0"><span className="block truncate font-extrabold text-teal-950">{customer.name}</span><span className="mt-1 block text-xs text-muted-foreground">{customer.customerCode ? `${customer.customerCode} — ` : ""}{customer.phone}</span></span><span className="mr-3 shrink-0 text-xs font-bold text-teal-700">اختيار</span></button>)}{displayedCustomers?.filter(customer => { const query = visitPickerSearch.trim().toLowerCase(); if (!query) return true; return [customer.name, customer.phone, customer.customerCode ?? ""].some(value => value.toLowerCase().includes(query)); }).length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">لا توجد نتائج مطابقة</p>}</div></div><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setVisitPickerOpen(false)} className="rounded-xl">إلغاء</Button><Button type="button" onClick={() => chooseVisitCustomer()} className="rounded-xl bg-teal-700 hover:bg-teal-800">فتح بطاقة التسجيل</Button></div></div></DialogContent></Dialog>
      <Dialog open={visitCustomer !== null} onOpenChange={handleVisitDialogOpenChange}><DialogContent dir="rtl" className="flex max-h-[90vh] flex-col overflow-hidden"><DialogHeader className="shrink-0"><DialogTitle>تسجيل زيارة جديدة</DialogTitle><DialogDescription>{visitCustomer ? `للعميل: ${visitCustomer.name} — ${visitCustomer.customerCode}` : ""}</DialogDescription></DialogHeader><form onSubmit={submitVisit} className="min-h-0 space-y-4 overflow-y-auto py-2 pl-1"><label><span className="field-label">نوع الزيارة</span><select className="field-input" value={visitType} onChange={event => updateVisitType(event.target.value as keyof typeof visitTypeLabels)}>{Object.entries(visitTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="field-label">تاريخ ووقت الزيارة</span><input type="datetime-local" className="field-input" value={visitDate} onChange={event => setVisitDate(event.target.value)} required /></label><label><span className="field-label">اسم الفني</span><select aria-label="اسم الفني" className="field-input" value={visitTechnicianId} onChange={event => { const id = event.target.value; const technician = visibleTechnicians.find(item => String(item.id) === id); setVisitTechnicianId(id); setVisitTechnicianName(technician?.name ?? ""); }}><option value="">اختر الفني</option>{visibleTechnicians.map(technician => <option key={technician.id} value={String(technician.id)}>{technician.name ?? "فني بدون اسم"}</option>)}</select></label><label><span className="field-label">متابع عملاء</span><select aria-label="متابع العملاء" className="field-input" value={visitSalesAgentName} onChange={event => setVisitSalesAgentName(event.target.value)}><option value="">اختر المتابع</option>{salesAgentNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label><span className="field-label">عدد الفلاتر</span><input type="number" min="1" step="1" className="field-input" value={visitFilterCount} onChange={event => setVisitFilterCount(event.target.value)} /></label><label><span className="field-label">المبلغ المحصل</span><input type="number" min="0" step="1" className="field-input" value={visitCollectedAmount} onChange={event => setVisitCollectedAmount(event.target.value)} placeholder="مثال: 250" /></label><div className="grid gap-3 sm:grid-cols-2"><label><span className="field-label">نسبة أملاح الدخول قبل الفلتر (TDS In)</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={visitTdsIn} onChange={event => setVisitTdsIn(event.target.value)} placeholder="اختياري" /></label><label><span className="field-label">نسبة أملاح الخروج بعد الفلتر (TDS Out)</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={visitTdsOut} onChange={event => setVisitTdsOut(event.target.value)} placeholder="اختياري" /></label></div><label><span className="field-label">نتيجة الزيارة</span><textarea className="field-textarea" value={visitResult} onChange={event => setVisitResult(event.target.value)} placeholder="ما الذي تم تنفيذه؟" /></label><label className="sm:col-span-2"><span className="field-label">ملاحظات الزيارة</span><textarea className="field-textarea" value={visitNotes} onChange={event => setVisitNotes(event.target.value)} placeholder="اكتب تفاصيل مختصرة عن الخدمة" /></label><UsedItemsSection items={visitItems} setItems={setVisitItems} catalogItems={effectiveServiceCatalog?.items ?? []} manualName={manualItemName} setManualName={setManualItemName} manualQuantity={manualItemQuantity} setManualQuantity={setManualItemQuantity} onAdd={addManualVisitItem} onQuickAdd={item => setVisitItems(current => addOrIncrementVisitItem(current, item))} listId="visit-inventory-items" /><div className="sticky bottom-0 flex justify-end gap-3 border-t border-teal-100 bg-white/95 pt-3 backdrop-blur"><Button type="button" variant="outline" onClick={() => setVisitCustomer(null)} className="rounded-xl">إلغاء</Button><Button type="submit" disabled={createVisit.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800">{createVisit.isPending ? "جارٍ التسجيل…" : "حفظ الزيارة"}</Button></div></form></DialogContent></Dialog>
      <Dialog open={importOpen} onOpenChange={handleImportOpenChange}><DialogContent dir="rtl" className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2 text-teal-950"><FileSpreadsheet className="h-5 w-5 text-teal-700" />استيراد العملاء من Excel</DialogTitle><DialogDescription>ارفع الشيت بدل التسجيل اليدوي. يجب أن يحتوي على اسم العميل والهاتف، ويمكن إضافة العنوان والموقع والملاحظات.</DialogDescription></DialogHeader><div className="min-h-0 space-y-4 overflow-y-auto py-2"><div className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-teal-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-extrabold text-teal-950">{importFileName || "لم يتم اختيار ملف"}</p><p className="mt-1 text-xs font-bold leading-5 text-teal-800">يدعم xlsx وxls. سيتم فحص الاسم والهاتف ومنع التكرار قبل الحفظ.</p>{importSheetNames.length > 1 && <p className="mt-1 text-xs font-bold text-teal-700">تم العثور على {importSheetNames.length} أوراق؛ يمكنك اختيار الورقة الصحيحة بعد الرفع.</p>}</div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="rounded-xl" onClick={downloadCustomerImportTemplate}><FileSpreadsheet className="ml-2 h-4 w-4" />تحميل القالب</Button><label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-teal-700 px-4 text-sm font-extrabold text-white hover:bg-teal-800"><Upload className="ml-2 h-4 w-4" />اختيار ملف<input type="file" accept=".xlsx,.xls,.pdf,application/pdf" className="sr-only" onChange={event => { void handleCustomerImport(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div></div><div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/60 p-3"><p className="text-sm font-extrabold text-teal-950">أو الصق البيانات من Excel</p><p className="mt-1 text-xs font-medium text-teal-800">افتح الشيت، حدّد العناوين والصفوف، اضغط نسخ، ثم الصقها هنا. يجب أن يحتوي الصف الأول على «اسم العميل» و«الهاتف».</p><textarea className="field-input mt-2 min-h-24 w-full font-mono text-xs" value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder="اسم العميل\tالهاتف\tالعنوان\tالفني\tتاريخ الزيارة\nأحمد\t05xxxxxxxx\tالرياض\tمحمد\t2026-08-20" aria-label="بيانات العملاء المنسوخة من Excel" /><div className="mt-2 flex justify-end"><Button type="button" variant="outline" className="rounded-xl border-teal-300 bg-white text-teal-800" disabled={!pasteText.trim()} onClick={applyPastedCustomers}>تحليل البيانات الملصقة</Button></div></div>{importSheetNames.length > 1 && <label className="flex flex-col gap-1 rounded-2xl border border-teal-100 bg-white p-3 text-sm font-extrabold text-teal-900 sm:flex-row sm:items-center sm:justify-between"><span>ورقة العمل التي سيتم استيرادها</span><select className="field-input min-w-0 sm:w-72" value={importSheetName} onChange={event => { const nextSheetName = event.target.value; setImportSheetName(nextSheetName); if (importFile) void handleCustomerImport(importFile, nextSheetName); }} aria-label="اختيار ورقة العمل للاستيراد"><option value="">الاكتشاف التلقائي</option>{importSheetNames.map(sheetName => <option key={sheetName} value={sheetName}>{sheetName}</option>)}</select></label>}{importRows.length > 0 && <div className="flex flex-wrap gap-2 text-xs font-extrabold"><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-800">صفوف جاهزة: {importRows.length}</span><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-800">تنبيهات: {importIssues.length}</span></div>}{importMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-extrabold text-emerald-800">{importMessage}</div>}{importIssues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-extrabold text-amber-900">صفوف تحتاج مراجعة</p><Button type="button" variant="outline" className="h-9 rounded-lg border-amber-300 bg-white text-xs font-extrabold text-amber-900 hover:bg-amber-100" onClick={() => { downloadCustomerImportIssues(importIssues); toast.success("تم تنزيل تقرير أخطاء الاستيراد"); }}><Download className="ml-1.5 h-3.5 w-3.5" />تنزيل تقرير الأخطاء</Button></div><div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs font-bold text-amber-800">{importIssues.slice(0, 30).map(issue => <p key={`${issue.rowNumber}-${issue.reason}`}>صف {issue.rowNumber}: {issue.reason}</p>)}</div></div>}{importRows.length > 0 && <div className="overflow-x-auto rounded-xl border border-teal-100"><table className="w-full min-w-[720px] text-right text-xs"><thead className="bg-teal-50 text-teal-950"><tr><th className="px-3 py-2">الصف</th><th className="px-3 py-2">الاسم</th><th className="px-3 py-2">الهاتف</th><th className="px-3 py-2">الكود</th><th className="px-3 py-2">العنوان</th><th className="px-3 py-2">الفني</th><th className="px-3 py-2">الزيارة</th><th className="px-3 py-2">المبلغ</th><th className="px-3 py-2">المتابعة القادمة</th><th className="px-3 py-2">الملاحظات</th></tr></thead><tbody>{importRows.slice(0, 50).map(row => <tr key={row.rowNumber} className="border-t border-teal-100"><td className="px-3 py-2 font-bold">{row.rowNumber}</td><td className="px-3 py-2 font-extrabold">{row.name}</td><td className="px-3 py-2" dir="ltr">{row.phone}</td><td className="px-3 py-2">{row.manualCode || "—"}</td><td className="max-w-52 truncate px-3 py-2">{row.address || "—"}</td><td className="max-w-40 truncate px-3 py-2">{row.technicianName || "—"}</td><td className="px-3 py-2">{row.visitDate ? `${row.visitType || "زيارة"} — ${new Date(row.visitDate).toLocaleDateString("ar-SA")}` : "—"}</td><td className="px-3 py-2">{row.collectedAmount != null ? Math.round(Number(row.collectedAmount)).toLocaleString("ar-SA", { maximumFractionDigits: 0 }) : "—"}</td><td className="px-3 py-2">{row.nextVisitDate ? new Date(row.nextVisitDate).toLocaleDateString("ar-SA") : "—"}</td><td className="max-w-52 truncate px-3 py-2">{row.notes || "—"}</td></tr>)}</tbody></table>{importRows.length > 50 && <p className="p-2 text-center text-xs font-bold text-muted-foreground">تُعرض أول 50 صفًا فقط، وسيتم حفظ جميع الصفوف الجاهزة.</p>}</div>}</div><div className="flex flex-wrap justify-end gap-2 border-t border-teal-100 pt-3"><Button type="button" variant="outline" className="rounded-xl" onClick={() => { setImportOpen(false); resetCustomerImport(); }}>إلغاء</Button><Button type="button" className="rounded-xl bg-teal-700 hover:bg-teal-800" disabled={!importRows.length || importCustomers.isPending} onClick={submitCustomerImport}>{importCustomers.isPending ? "جارٍ الحفظ…" : `حفظ ${importRows.length} صفًا`}</Button></div></DialogContent></Dialog>
      <Dialog open={sharedLocationOpen} onOpenChange={setSharedLocationOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>اختيار العميل للموقع المشارك</DialogTitle><DialogDescription>تم استقبال موقع من واتساب. اختر العميل الذي أرسل الموقع، ثم راجع البيانات واضغط حفظ.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900" dir="ltr">{sharedLocationValue}</div><label className="block"><span className="field-label">العميل</span><select className="field-input" value={sharedCustomerId} onChange={event => setSharedCustomerId(event.target.value)}><option value="">اختر العميل</option>{displayedCustomers?.map(customer => <option key={customer.id} value={customer.id}>{customer.name} — {customer.phone}</option>)}</select></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" className="rounded-xl" onClick={() => setSharedLocationOpen(false)}>إلغاء</Button><Button type="button" className="rounded-xl bg-teal-700 hover:bg-teal-800" onClick={applySharedLocation}>فتح بيانات العميل</Button></div></div></DialogContent></Dialog>
      <PinVerificationDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }} busy={deleteCustomer.isPending} title="تأكيد حذف العميل" description="سيتم حذف العميل وجميع الزيارات والتذكيرات والعمليات المرتبطة به نهائيًا." onConfirm={pin => { if (deleteId !== null) { const customer = displayedCustomers.find(item => item.id === deleteId); if (customer) moveToTrash({ entityType: "customer", entityLabel: `العميل: ${customer.name}`, payload: customer }); deleteCustomer.mutate({ id: deleteId, pin }); } }} />
      <PinVerificationDialog open={pinOpen} onOpenChange={open => { if (!open) { setPinOpen(false); setPendingUpdate(null); } }} busy={updateCustomer.isPending} title="تأكيد تعديل بيانات العميل" onConfirm={pin => { if (pendingUpdate) updateCustomer.mutate({ ...pendingUpdate, pin }); }} />
    </div>
  );
}

export function UsedItemsSection({ items, setItems, catalogItems, manualName, setManualName, manualQuantity, setManualQuantity, onAdd, onQuickAdd, listId }: { items: UsedVisitItem[]; setItems: React.Dispatch<React.SetStateAction<UsedVisitItem[]>>; catalogItems: CatalogItem[]; manualName: string; setManualName: (value: string) => void; manualQuantity: string; setManualQuantity: (value: string) => void; onAdd: () => void; onQuickAdd?: (item: CatalogItem) => void; listId: string }) {
  return <div className="mt-4 rounded-2xl border-2 border-teal-200 bg-teal-50/70 p-4 sm:col-span-2" data-testid="used-items-section"><div className="flex items-start justify-between gap-3"><div><p className="text-base font-extrabold text-teal-950">قطع الغيار والأصناف المستخدمة</p><p className="mt-1 text-xs font-medium leading-5 text-teal-800">اختر الأصناف التي تم تركيبها أو صرفها؛ سيتم خصمها تلقائيًا من رصيد المخزن بعد الحفظ.</p></div><span className="rounded-full bg-teal-700 px-3 py-1 text-xs font-extrabold text-white">{items.length} أصناف</span></div><div className="mt-3 space-y-2">{items.map((item, index) => { const catalogItem = catalogItems.find(entry => entry.id === item.inventoryItemId); return <div key={item.inventoryItemId} className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-100 bg-white p-2"><span className="min-w-40 flex-1 text-sm font-bold text-teal-950"><span className="block">{catalogItem?.name ?? `صنف رقم ${item.inventoryItemId}`}</span><span className={`mt-0.5 block text-xs ${catalogItem?.currentBalance !== undefined && item.quantity > catalogItem.currentBalance ? "font-extrabold text-rose-700" : "font-bold text-teal-700"}`}>الرصيد المتاح: {catalogItem?.currentBalance ?? "غير معروف"}{catalogItem?.unit ? ` ${catalogItem.unit}` : ""}</span></span><input aria-label={`كمية ${catalogItem?.name ?? item.inventoryItemId}`} type="number" min="1" max={catalogItem?.currentBalance} className="field-input h-9 w-24" value={item.quantity} onChange={event => { const quantity = Number.parseInt(event.target.value, 10); const safeQuantity = Number.isFinite(quantity) ? Math.max(1, catalogItem?.currentBalance !== undefined ? Math.min(quantity, catalogItem.currentBalance) : quantity) : 1; setItems(current => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, quantity: safeQuantity } : entry)); }} /><button type="button" className="rounded-lg px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50" onClick={() => setItems(current => current.filter((_, rowIndex) => rowIndex !== index))}>إزالة</button></div>; })}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input list={listId} className="field-input flex-1" value={manualName} onChange={event => setManualName(event.target.value)} placeholder="اكتب أو اختر صنفًا من المخزن" aria-label="إضافة صنف مستخدم" /><datalist id={listId}>{catalogItems.map(item => <option key={item.id} value={item.name} />)}</datalist>{onQuickAdd && catalogItems.length > 0 && <div className="mt-3 rounded-xl border border-dashed border-teal-200 bg-white/70 p-3"><p className="mb-2 text-xs font-extrabold text-teal-800">إضافة سريعة من أصناف المخزن</p><div className="flex flex-wrap gap-2">{catalogItems.map(item => { const selectedQuantity = items.find(entry => entry.inventoryItemId === item.id)?.quantity ?? 0; const balance = item.currentBalance; const unavailable = balance !== undefined && balance <= 0; const exhausted = balance !== undefined && selectedQuantity >= balance; return <button key={item.id} type="button" disabled={unavailable || exhausted} onClick={() => onQuickAdd(item)} className={`rounded-lg border px-3 py-2 text-xs font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${unavailable || exhausted ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400" : "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100"}`}><span className="block">+ {item.name}</span><span className="mt-0.5 block text-[10px] font-bold">الرصيد: {balance ?? "غير معروف"}{item.unit ? ` ${item.unit}` : ""}</span></button>; })}</div></div>}<input type="number" min="1" className="field-input w-full sm:w-24" value={manualQuantity} onChange={event => setManualQuantity(event.target.value)} aria-label="كمية الصنف الإضافي" /><Button type="button" variant="outline" onClick={onAdd} className="rounded-xl whitespace-nowrap"><Plus className="ml-1 h-4 w-4" />إضافة صنف</Button></div></div>;
}

function Field({ label, value, onChange, required, dir, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; dir?: "ltr" | "rtl"; placeholder?: string }) { return <label><span className="field-label">{label}</span><input className="field-input" value={value} dir={dir} placeholder={placeholder} required={required} onChange={event => onChange(event.target.value)} /></label>; }
