import { Badge } from "@/components/ui/badge";
import { PinVerificationDialog } from "@/components/PinVerificationDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatDate, toDateTimeLocal } from "@/lib/filterUi";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Droplets, Filter, PackagePlus, PackageSearch, Plus, Refrigerator, Snowflake } from "lucide-react";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { moveToTrash } from "@/lib/trashBin";
import { canRemoveInventoryCategory, getInventoryCategoryOptions, INVENTORY_CATEGORY_OPTIONS, INVENTORY_CATEGORY_STORAGE_KEY, readCustomInventoryCategories } from "@/lib/inventoryCategories";
import { formatAppMoney } from "@/lib/appSettings";
import { extractArray } from "@/lib/dataNormalization";

export default function Inventory() {
  const [location, navigate] = useLocation();
  const [focusedItemId, setFocusedItemId] = useState(() => Number(new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("item") ?? 0));
  const selectedItemId = focusedItemId || Number(new URLSearchParams(location.includes("?") ? location.split("?")[1] : typeof window !== "undefined" ? window.location.search : "").get("item") ?? 0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
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
  const centralQueryOptions = { retry: false, staleTime: 5_000, refetchInterval: 8_000, refetchOnReconnect: true, refetchOnWindowFocus: false, networkMode: "online" as const };
  const inventoryQuery = trpc.filters.inventory.summary.useQuery(undefined, centralQueryOptions);
  const techniciansQuery = trpc.filters.technicians.list.useQuery(undefined, { ...centralQueryOptions, staleTime: 30_000 });
  const visibleTechnicians = Array.isArray(techniciansQuery.data) ? techniciansQuery.data : [];
  const rawInventory = inventoryQuery.data;
  const data = {
    ...(rawInventory && typeof rawInventory === "object" ? rawInventory : {}),
    items: extractArray<any>((rawInventory as any)?.items),
    movements: extractArray<any>((rawInventory as any)?.movements),
  } as NonNullable<typeof inventoryQuery.data>;
  const isLoading = inventoryQuery.isLoading && !inventoryQuery.data;
  const isError = inventoryQuery.isError;
  const lowStockItems = useMemo(() => (Array.isArray(data.items) ? data.items : []).filter(item => item.currentBalance <= (item.reorderLevel ?? 2)).slice(0, 3), [data]);
  useEffect(() => {
    if (!lowStockItems.length || typeof window === "undefined") return;
    const signature = lowStockItems.map(item => `${item.id}:${item.currentBalance}:${item.reorderLevel ?? 2}`).join("|");
    const storageKey = "purepoint-low-stock-alert";
    if (window.localStorage.getItem(storageKey) === signature) return;
    const names = lowStockItems.map(item => `${item.name} (${item.currentBalance})`).join("، ");
    toast.warning(`تنبيه المخزن: ${names}`, { description: "وصل الرصيد إلى الحد الأدنى أو انخفض عنه. يُرجى مراجعة الكمية." });
    window.localStorage.setItem(storageKey, signature);
  }, [lowStockItems]);
  useEffect(() => {
    if (!selectedItemId) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-inventory-item-id="${selectedItemId}"]`));
    const target = targets.find(element => element.offsetParent !== null) ?? targets[0];
    if (!target) return;
    window.requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.28), behavior: "smooth" });
    });
  }, [selectedItemId, data.items.length]);
  const utils = trpc.useUtils();
  const [itemDialog, setItemDialog] = useState(false);
  const [movementItem, setMovementItem] = useState<{ id: number; name: string; defaultUnitCost?: number | null } | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("مستلزمات تركيب");
  const [customCategories, setCustomCategories] = useState<string[]>(readCustomInventoryCategories);
  const [newCategory, setNewCategory] = useState("");
  const categoryOptions = useMemo(() => getInventoryCategoryOptions(customCategories), [customCategories]);
  const [itemUnit, setItemUnit] = useState("قطعة");
  const [reorderLevel, setReorderLevel] = useState("2");
  const [defaultUnitCost, setDefaultUnitCost] = useState("0");
  const [openingQuantity, setOpeningQuantity] = useState("0");
  const [itemNotes, setItemNotes] = useState("");
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [movementErrors, setMovementErrors] = useState<Record<string, string>>({});
  const clearItemError = (field: string) => setItemErrors(current => { if (!current[field]) return current; const next = { ...current }; delete next[field]; return next; });
  const clearMovementError = (field: string) => setMovementErrors(current => { if (!current[field]) return current; const next = { ...current }; delete next[field]; return next; });
  function firstInvalidField(form: HTMLFormElement) { const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]'); invalid?.focus(); }
  const FieldError = ({ message }: { message?: string }) => message ? <p role="alert" className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null;
  const [movementType, setMovementType] = useState<"incoming" | "outgoing">("incoming");
  function focusInventoryItem(itemId: number) {
    setFocusedItemId(itemId);
    navigate(`/inventory?item=${itemId}`);
  }
  function openMovement(item: { id: number; name: string; defaultUnitCost?: number | null }, type: "incoming" | "outgoing") {
    setMovementType(type);
    setMovementItem(item);
    setQuantity("");
    setUnitCost(type === "incoming" && (item.defaultUnitCost ?? 0) > 0 ? String(item.defaultUnitCost ?? 0) : "");
    setTechnicianName("");
    setMovementNotes("");
  }
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [movementCurrency, setMovementCurrency] = useState<"SAR">("SAR");
  const [movementDate, setMovementDate] = useState(toDateTimeLocal());
  const [technicianName, setTechnicianName] = useState("");
  const [movementNotes, setMovementNotes] = useState("");
  const [pinAction, setPinAction] = useState<{ kind: "item" | "movement"; id: number } | null>(null);
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const safeInventoryItems = Array.isArray(data.items) ? data.items : [];
  const safeInventoryMovements = Array.isArray(data.movements) ? data.movements : [];
  const detailItem = detailItemId ? safeInventoryItems.find(item => item.id === detailItemId) : null;
  const detailMovements = detailItemId ? safeInventoryMovements.filter(movement => movement.inventoryItemId === detailItemId) : [];
  const detailIncoming = detailMovements.filter(movement => movement.movementType === "incoming");
  const detailOutgoing = detailMovements.filter(movement => movement.movementType === "outgoing");
  const detailIncomingQuantity = detailIncoming.reduce((total, movement) => total + Number(movement.quantity || 0), 0);
  const detailOutgoingQuantity = detailOutgoing.reduce((total, movement) => total + Number(movement.quantity || 0), 0);
  const detailPurchaseTotal = detailIncoming.reduce((total, movement) => total + Number(movement.unitCost || 0) * Number(movement.quantity || 0), 0);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(INVENTORY_CATEGORY_STORAGE_KEY, JSON.stringify(customCategories));
  }, [customCategories]);

  function addInventoryCategory() {
    const normalized = newCategory.trim();
    if (!normalized) { toast.error("اكتب اسم النوع أولًا."); return; }
    if (categoryOptions.some(category => category.localeCompare(normalized, "ar", { sensitivity: "base" }) === 0)) { toast.info("هذا النوع موجود بالفعل."); return; }
    setCustomCategories(current => [...current, normalized]);
    setItemCategory(normalized);
    setNewCategory("");
    toast.success(`تمت إضافة نوع «${normalized}»`);
  }

  function removeInventoryCategory(category: string) {
    const usedBy = data.items.filter(item => item.category === category);
    if (!canRemoveInventoryCategory(category, data.items)) { toast.error(`لا يمكن حذف «${category}» لأنه مستخدم في ${usedBy.length} صنفًا. غيّر نوع الأصناف أولًا للحفاظ على الحركات السابقة.`); return; }
    setCustomCategories(current => current.filter(value => value !== category));
    if (itemCategory === category) setItemCategory("مستلزمات تركيب");
    toast.success(`تم حذف النوع «${category}» من قائمة الاختيار فقط.`);
  }

  const createItem = trpc.filters.inventory.createItem.useMutation({
    onSuccess: result => {
      utils.filters.inventory.summary.invalidate();
      utils.filters.dashboard.invalidate();
      utils.filters.cash.summary.invalidate();
      toast.success(result.merged ? "الصنف موجود؛ تمت إضافة الكمية كوارد وتسجيل تكلفتها" : "تمت إضافة الصنف إلى المخزن");
      setItemDialog(false); setItemName(""); setItemCategory("مستلزمات تركيب"); setItemUnit("قطعة"); setReorderLevel("2"); setDefaultUnitCost("0"); setOpeningQuantity("0"); setItemNotes("");
    },
    onError: error => toast.error(error.message || "تعذر إضافة الصنف. يرجى المحاولة مرة أخرى."),
  });
  const deleteItem = trpc.filters.inventory.deleteItem.useMutation({ onSuccess: () => { utils.filters.inventory.summary.invalidate(); utils.filters.dashboard.invalidate(); setPinAction(null); toast.success("تم حذف الصنف وحركاته المرتبطة"); }, onError: error => toast.error(error.message || "تعذر حذف الصنف.") });
  const deleteMovement = trpc.filters.inventory.deleteMovement.useMutation({ onSuccess: () => { utils.filters.inventory.summary.invalidate(); utils.filters.dashboard.invalidate(); setPinAction(null); toast.success("تم حذف حركة المخزن"); }, onError: error => toast.error(error.message || "تعذر حذف الحركة.") });
  const createMovement = trpc.filters.inventory.createMovement.useMutation({
    onSuccess: () => {
      utils.filters.inventory.summary.invalidate();
      utils.filters.dashboard.invalidate();
      toast.success(movementType === "outgoing" ? "تم تسجيل المنصرف وتحديث الرصيد" : "تم تسجيل الوارد وتحديث الرصيد");
      setMovementItem(null); setQuantity(""); setUnitCost(""); setMovementCurrency("SAR"); setTechnicianName(""); setMovementNotes("");
    },
    onError: error => toast.error(error.message || "تعذر تسجيل الحركة. يرجى المحاولة مرة أخرى."),
  });


  function submitItem(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!itemName.trim()) errors.itemName = "اسم الصنف مطلوب.";
    if (!itemCategory.trim()) errors.itemCategory = "نوع الصنف مطلوب.";
    if (openingQuantity.trim() === "" || Number(openingQuantity) < 0 || !Number.isFinite(Number(openingQuantity))) errors.openingQuantity = "أدخل الرصيد الافتتاحي.";
    setItemErrors(errors);
    if (Object.keys(errors).length) { firstInvalidField(event.currentTarget as HTMLFormElement); return; }
    const input = { name: itemName, category: itemCategory.trim() || "عام", unit: itemUnit.trim() || "قطعة", reorderLevel: Number(reorderLevel || 0), defaultUnitCost: Math.round(Number(defaultUnitCost || 0)), openingQuantity: Number(openingQuantity || 0), notes: itemNotes || null };
    if (!online) {
      toast.error("إضافة الصنف تحتاج اتصالًا مباشرًا بقاعدة البيانات المركزية.");
      return;
    }
    createItem.mutate(input);
  }
  function submitMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementItem) return;
    const errors: Record<string, string> = {};
    if (quantity.trim() === "" || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) errors.quantity = "أدخل كمية صحيحة أكبر من صفر.";
    if (movementType === "incoming" && (unitCost.trim() === "" || Number(unitCost) < 0 || !Number.isFinite(Number(unitCost)))) errors.unitCost = "أدخل سعر شراء القطعة.";
    if (!movementDate) errors.movementDate = "تاريخ الحركة مطلوب.";
    setMovementErrors(errors);
    if (Object.keys(errors).length) { firstInvalidField(event.currentTarget as HTMLFormElement); return; }
    const input = { inventoryItemId: movementItem.id, movementType, quantity: Number(quantity), unitCost: movementType === "incoming" ? Math.round(Number(unitCost || 0)) : 0, currency: movementCurrency, movementDate: new Date(movementDate), technicianName: technicianName || null, notes: movementNotes || null };
    if (!online) {
      toast.error("تسجيل حركة المخزن يحتاج اتصالًا مباشرًا بقاعدة البيانات المركزية.");
      return;
    }
    createMovement.mutate(input);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h1 className="page-heading">إدارة المخزن</h1><p className="page-subheading">تابع الأصناف والرصيد وحركات الوارد والمنصرف من مكان واحد.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setItemDialog(true)} className="h-11 rounded-xl bg-teal-700 px-5 font-bold hover:bg-teal-800"><Plus className="ml-2 h-5 w-5" />إضافة صنف جديد</Button>
          <span className="inline-flex h-11 items-center rounded-xl border border-teal-100 bg-teal-50 px-4 text-xs font-bold text-teal-800">الصرف يتم من بطاقة الصنف</span>
        </div>
      </div>

      <section aria-labelledby="inventory-items-cards" className="rounded-2xl border border-teal-100 bg-teal-50/60 p-2.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <h2 id="inventory-items-cards" className="text-sm font-extrabold text-teal-950">أصناف المخزن</h2>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-teal-700 ring-1 ring-teal-100">اختيار سريع</span>
        </div>
        {data.items.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {data.items.map(item => <button key={item.id} type="button" onClick={() => focusInventoryItem(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusInventoryItem(item.id); } }} className="inventory-item-card flex min-w-0 items-start gap-2 rounded-xl border border-white bg-white px-2.5 py-2.5 text-right shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500" aria-label={`الصنف ${item.name}، رقم المخزون ${item.id}، الرصيد ${item.currentBalance}`}>
            <InventoryVisual compact category={item.category} name={item.name} customEmoji={item.customEmoji} imageUrl={item.imageUrl} />
            <span className="min-w-0 flex-1"><span className="block whitespace-normal break-words text-[12px] font-extrabold leading-4 text-teal-950" title={item.name}>{item.name}</span><span className="mt-1 block truncate text-[10px] font-bold text-amber-700" title={item.category || "عام"}>{item.category || "عام"}</span><span className="mt-1 block text-xs font-bold text-slate-600">الرصيد: <b className={`text-sm ${balanceTextClass(item.currentBalance, item.reorderLevel)}`}>{item.currentBalance}</b></span></span>
          </button>)}
        </div> : <p className="px-2 py-3 text-center text-xs text-muted-foreground">ستظهر بطاقات الأصناف هنا بعد إضافة أول صنف.</p>}
      </section>

      <section className="soft-card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-right">
            <thead className="bg-teal-50/70 text-xs text-teal-950/65"><tr><th className="px-5 py-4 font-bold">الصنف</th><th className="px-5 py-4 font-bold">الرصيد الافتتاحي</th><th className="px-5 py-4 font-bold">الرصيد الحالي</th><th className="px-5 py-4 font-bold">الحالة</th><th className="px-5 py-4 font-bold">إجراء</th></tr></thead>
            <tbody className="divide-y divide-teal-950/6">
              {data?.items.length ? data.items.map(item => <InventoryTableRow key={item.id} item={item} selected={item.id === selectedItemId} onDetails={() => setDetailItemId(item.id)} onMovement={() => openMovement({ id: item.id, name: item.name, defaultUnitCost: item.defaultUnitCost }, "outgoing")} onIncoming={() => openMovement({ id: item.id, name: item.name, defaultUnitCost: item.defaultUnitCost }, "incoming")} onDelete={() => setPinAction({ kind: "item", id: item.id })} />) : <EmptyInventoryRow isLoading={isLoading} />}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-teal-950/6 md:hidden">
          {data?.items.length ? data.items.map(item => (
            <div data-inventory-item-id={item.id} key={item.id} className={`inventory-item-row space-y-4 p-5 transition-[background-color,box-shadow] duration-500 ease-out ${item.id === selectedItemId ? "inventory-item-row-selected bg-orange-100 ring-2 ring-inset ring-orange-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,.45)]" : "hover:bg-teal-50/40"}`} onClick={event => { if ((event.target as HTMLElement).closest("button")) return; setDetailItemId(item.id); }} role="button" tabIndex={0} title="اضغط لعرض كل بيانات الصنف" onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetailItemId(item.id); } }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <InventoryVisual category={item.category} name={item.name} customEmoji={item.customEmoji} imageUrl={item.imageUrl} />
                  <div className="min-w-0">
                    <p className="mt-1 text-lg font-extrabold leading-7 text-teal-950">{item.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.category}</span>
                      <span className="rounded-full bg-teal-50 px-2 py-1 text-teal-700">الوحدة: {item.unit}</span>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">تنبيه عند: {item.reorderLevel}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">أضيف في: {formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <StockBadge balance={item.currentBalance} reorderLevel={item.reorderLevel} />
              </div>
              {item.notes ? <p className="text-xs leading-5 text-muted-foreground">{item.notes}</p> : null}
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-teal-50/60 p-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">الرصيد الافتتاحي</p><p className="mt-1 font-extrabold">{item.openingQuantity}</p></div>
                <div><p className="text-xs text-muted-foreground">الرصيد الحالي</p><p className={`mt-1 text-lg font-extrabold ${balanceTextClass(item.currentBalance, item.reorderLevel)}`}>{item.currentBalance}</p></div>
                <div><p className="text-xs text-muted-foreground">سعر الوحدة</p><p className="mt-1 font-extrabold">{formatMoney(item.openingUnitCost ?? item.defaultUnitCost ?? 0)}</p></div>
                <div><p className="text-xs text-muted-foreground">تاريخ الإضافة</p><p className="mt-1 font-extrabold">{formatDate(item.openingAddedAt ?? item.createdAt)}</p></div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid grid-cols-2 gap-2 sm:col-span-2"><Button size="sm" variant="outline" onClick={() => openMovement({ id: item.id, name: item.name, defaultUnitCost: item.defaultUnitCost }, "incoming")} className="w-full rounded-xl border-emerald-200 text-emerald-800 hover:bg-emerald-50"><PackagePlus className="ml-1 h-4 w-4" />إضافة وارد</Button><Button size="sm" variant="outline" onClick={() => openMovement({ id: item.id, name: item.name, defaultUnitCost: item.defaultUnitCost }, "outgoing")} className="w-full rounded-xl border-teal-700/20 text-teal-800 hover:bg-teal-50"><PackagePlus className="ml-1 h-4 w-4" />صرف صنف</Button></div>
                <Button size="sm" variant="outline" onClick={() => setDetailItemId(item.id)} className="w-full rounded-xl border-violet-200 text-violet-800 hover:bg-violet-50">تفاصيل الصنف</Button>
                <Button size="sm" variant="outline" onClick={() => setPinAction({ kind: "item", id: item.id })} className="w-full rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 sm:col-span-3">حذف الصنف</Button>
              </div>
            </div>
          )) : <EmptyInventoryCard isLoading={isLoading} />}
        </div>
      </section>

      <section className="soft-card overflow-hidden">
        <div className="border-b border-teal-950/6 p-5"><h2 className="font-extrabold">آخر حركات المخزن</h2><p className="mt-1 text-xs text-muted-foreground">الوارد والمنصرف مع تفاصيل الفني والعميل المرتبط بالخصم.</p></div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-right">
            <thead className="bg-teal-50/45 text-xs text-teal-950/65"><tr><th className="px-5 py-3 font-bold">التاريخ</th><th className="px-5 py-3 font-bold">الصنف</th><th className="px-5 py-3 font-bold">نوع الحركة</th><th className="px-5 py-3 font-bold">الكمية</th><th className="px-5 py-3 font-bold">التكلفة</th><th className="px-5 py-3 font-bold">الفني / المستلم</th><th className="px-5 py-3 font-bold">العميل</th><th className="px-5 py-3 font-bold">ملاحظات</th><th className="px-5 py-3 font-bold">إجراء</th></tr></thead>
            <tbody className="divide-y divide-teal-950/6">{data?.movements.length ? data.movements.map(movement => <MovementTableRow key={movement.id} movement={movement} onDelete={() => setPinAction({ kind: "movement", id: movement.id })} />) : <tr><td colSpan={9} className="p-10 text-center text-sm text-muted-foreground">لا توجد حركات في المخزن بعد.</td></tr>}</tbody>
          </table>
        </div>
        <div className="divide-y divide-teal-950/6 md:hidden">
          {data?.movements.length ? data.movements.map(movement => <div key={movement.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">الصنف</p><p className="mt-1 font-extrabold text-teal-950">{movement.inventoryItemName}</p></div><span className="font-extrabold">{movement.quantity} قطعة</span></div><div className="mt-3"><MovementType movementType={movement.movementType} /></div><div className="mt-3 grid grid-cols-2 gap-y-2 text-xs text-muted-foreground"><p>التاريخ</p><p className="text-left text-teal-950">{formatDate(movement.movementDate)}</p>{movement.movementType === "incoming" ? <><p>إجمالي التكلفة</p><p className="text-left font-bold text-violet-800">{formatMoney((movement.unitCost ?? 0) * movement.quantity)}</p></> : null}<p>الفني / المستلم</p><p className="text-left text-teal-950">{movement.technicianName || "—"}</p><p>العميل</p><p className="text-left text-teal-950">{movement.customerName || "—"}</p>{movement.notes ? <><p>ملاحظات</p><p className="text-left text-teal-950">{movement.notes}</p></> : null}</div><Button size="sm" variant="outline" onClick={() => setPinAction({ kind: "movement", id: movement.id })} className="mt-4 w-full rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50">حذف الحركة</Button></div>) : <div className="p-10 text-center text-sm text-muted-foreground">لا توجد حركات في المخزن بعد.</div>}
        </div>
      </section>

      <PinVerificationDialog open={pinAction !== null} onOpenChange={open => { if (!open) setPinAction(null); }} busy={deleteItem.isPending || deleteMovement.isPending} title={pinAction?.kind === "item" ? "تأكيد حذف الصنف" : "تأكيد حذف حركة المخزن"} description={pinAction?.kind === "item" ? "سيتم حذف الصنف وجميع حركاته المرتبطة نهائيًا." : "سيتم حذف الحركة وسجل الشراء المرتبط بها إن وجد."} onConfirm={pin => { if (!pinAction) return; const target = pinAction.kind === "item" ? data.items.find((item: any) => item.id === pinAction.id) : data.movements.find((movement: any) => movement.id === pinAction.id); if (target) { const relatedMovements = pinAction.kind === "item" ? (data.movements ?? []).filter((movement: any) => movement.inventoryItemId === pinAction.id) : []; moveToTrash({ entityType: "inventory", entityLabel: pinAction.kind === "item" ? `صنف من المخزن: ${(target as any).name ?? "غير مسمى"}` : `حركة من المخزن: ${(target as any).inventoryItemName ?? "غير مسمى"}`, payload: { kind: pinAction.kind, target, relatedMovements } }); } if (!online) { toast.error("حذف بيانات المخزن يحتاج اتصالًا مباشرًا بقاعدة البيانات المركزية."); return; } if (pinAction.kind === "item") deleteItem.mutate({ id: pinAction.id, pin }); else deleteMovement.mutate({ id: pinAction.id, pin }); }} />
      <Dialog open={Boolean(detailItem)} onOpenChange={open => !open && setDetailItemId(null)}><DialogContent dir="rtl" showCloseButton={false} onPointerDownOutside={() => setDetailItemId(null)} className="max-h-[calc(100vh-1rem)] overflow-hidden p-0 sm:max-w-2xl"><DialogClose aria-label="إغلاق تفاصيل الصنف" className="absolute left-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-teal-950/10 bg-background text-xl font-bold text-teal-950 shadow-md transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">×<span className="sr-only">إغلاق تفاصيل الصنف</span></DialogClose><DialogHeader className="sticky top-0 z-10 border-b border-teal-950/10 bg-background px-6 pb-4 pt-6"><DialogTitle>تفاصيل الصنف: {detailItem?.name}</DialogTitle><DialogDescription>كل بيانات الصنف وسجل التوريد في مكان واحد.</DialogDescription></DialogHeader><div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-6 pb-6 pt-4">{detailItem ? <div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl bg-teal-50 p-3"><p className="text-xs text-muted-foreground">النوع</p><p className="mt-1 font-black text-teal-950">{detailItem.category || "عام"}</p></div><div className="rounded-xl bg-cyan-50 p-3"><p className="text-xs text-muted-foreground">وحدة القياس</p><p className="mt-1 font-black text-cyan-800">{detailItem.unit || "قطعة"}</p></div><div className="rounded-xl bg-teal-50 p-3"><p className="text-xs text-muted-foreground">الرصيد الافتتاحي</p><p className="mt-1 font-black text-teal-950">{detailItem.openingQuantity ?? 0}</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-muted-foreground">الرصيد الحالي</p><p className="mt-1 font-black text-emerald-800">{detailItem.currentBalance}</p></div><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs text-muted-foreground">سعر الوحدة</p><p className="mt-1 font-black text-violet-800">{formatMoney(detailItem.openingUnitCost ?? detailItem.defaultUnitCost ?? 0)}</p></div><div className="rounded-xl bg-sky-50 p-3"><p className="text-xs text-muted-foreground">تاريخ الإضافة</p><p className="mt-1 font-black text-sky-800">{formatDate(detailItem.openingAddedAt ?? detailItem.createdAt)}</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-muted-foreground">إجمالي الوارد</p><p className="mt-1 font-black text-amber-800">{detailIncomingQuantity}</p></div><div className="rounded-xl bg-orange-50 p-3"><p className="text-xs text-muted-foreground">إجمالي المنصرف</p><p className="mt-1 font-black text-orange-800">{detailOutgoingQuantity}</p></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-muted-foreground">إجمالي تكلفة التوريد</p><p className="mt-1 font-black text-emerald-800">{formatMoney(detailPurchaseTotal)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">ملاحظات</p><p className="mt-1 font-bold text-slate-800">{detailItem.notes || "لا توجد ملاحظات"}</p></div></div><div className="rounded-2xl border border-teal-950/10"><div className="border-b border-teal-950/10 p-4"><h3 className="font-extrabold">سجل التوريد وتغير السعر</h3><p className="mt-1 text-xs text-muted-foreground">يعرض كل عملية وارد بسعرها وقت التوريد.</p></div>{detailMovements.filter(movement => movement.movementType === "incoming").length ? <div className="divide-y divide-teal-950/10">{detailMovements.filter(movement => movement.movementType === "incoming").map(movement => <div key={movement.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">التاريخ</p><p className="font-bold">{formatDate(movement.movementDate)}</p></div><div><p className="text-xs text-muted-foreground">الكمية</p><p className="font-bold">{movement.quantity} قطعة</p></div><div><p className="text-xs text-muted-foreground">سعر الوحدة</p><p className="font-bold text-violet-800">{formatMoney(movement.unitCost ?? 0)}</p></div><div><p className="text-xs text-muted-foreground">الإجمالي</p><p className="font-bold text-emerald-800">{formatMoney((movement.unitCost ?? 0) * movement.quantity)}</p></div></div>)}</div> : <p className="p-5 text-center text-sm text-muted-foreground">لا توجد عمليات توريد مسجلة لهذا الصنف.</p>}</div><div className="rounded-2xl border border-teal-950/10"><div className="border-b border-teal-950/10 p-4"><h3 className="font-extrabold">سجل المنصرف</h3><p className="mt-1 text-xs text-muted-foreground">يعرض الكمية والتاريخ والفني والعميل والملاحظات.</p></div>{detailOutgoing.length ? <div className="divide-y divide-teal-950/10">{detailOutgoing.map(movement => <div key={movement.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">التاريخ</p><p className="font-bold">{formatDate(movement.movementDate)}</p></div><div><p className="text-xs text-muted-foreground">الكمية</p><p className="font-bold text-orange-800">{movement.quantity} قطعة</p></div><div><p className="text-xs text-muted-foreground">الفني / المستلم</p><p className="font-bold">{movement.technicianName || "—"}</p></div><div><p className="text-xs text-muted-foreground">العميل</p><p className="font-bold">{movement.customerName || "—"}</p></div><div><p className="text-xs text-muted-foreground">ملاحظات</p><p className="font-bold">{movement.notes || "—"}</p></div></div>)}</div> : <p className="p-5 text-center text-sm text-muted-foreground">لا توجد عمليات صرف مسجلة لهذا الصنف.</p>}</div></div> : null}</div></DialogContent></Dialog>
      <Dialog open={itemDialog} onOpenChange={setItemDialog}><DialogContent dir="rtl" className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col overflow-hidden sm:max-w-2xl"><DialogHeader className="shrink-0"><DialogTitle>إضافة صنف جديد إلى المخزن</DialogTitle><DialogDescription>اكتب اسم الصنف والكمية، ثم احفظ. باقي البيانات اختيارية ويمكن تعديلها لاحقًا.</DialogDescription></DialogHeader><form onSubmit={submitItem} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-2 pl-1 pr-1"><div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">اسم الصنف</span><input className="field-input" value={itemName} onChange={event => { setItemName(event.target.value); clearItemError("itemName"); }} aria-invalid={Boolean(itemErrors.itemName)} aria-describedby={itemErrors.itemName ? "item-name-error" : undefined} placeholder="مثال: شمعة كربون أو فلتر جامبو" />{itemErrors.itemName ? <p id="item-name-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">{itemErrors.itemName}</p> : null}</label><label><span className="field-label">نوع الصنف</span><select className="field-input" value={categoryOptions.includes(itemCategory) ? itemCategory : "أخرى"} onChange={event => setItemCategory(event.target.value === "أخرى" ? "" : event.target.value)}><option value="" disabled>اختر نوع الصنف</option>{categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}</select>{(!itemCategory || !categoryOptions.includes(itemCategory)) ? <input className="field-input mt-2" value={itemCategory} onChange={event => { setItemCategory(event.target.value); clearItemError("itemCategory"); }} aria-invalid={Boolean(itemErrors.itemCategory)} aria-describedby={itemErrors.itemCategory ? "item-category-error" : undefined} placeholder="اكتب نوعًا مخصصًا" /> : null}</label><label><span className="field-label">وحدة القياس</span><input className="field-input" value={itemUnit} onChange={event => setItemUnit(event.target.value)} placeholder="قطعة" /></label><label><span className="field-label">الرصيد الافتتاحي</span><input type="number" min="0" className="field-input" value={openingQuantity} onChange={event => { setOpeningQuantity(event.target.value); clearItemError("openingQuantity"); }} aria-invalid={Boolean(itemErrors.openingQuantity)} aria-describedby={itemErrors.openingQuantity ? "opening-quantity-error" : undefined} />{itemErrors.openingQuantity ? <p id="opening-quantity-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">{itemErrors.openingQuantity}</p> : null}</label><label><span className="field-label">الحد الأدنى للرصيد</span><input type="number" min="0" className="field-input" value={reorderLevel} onChange={event => setReorderLevel(event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">يظهر تنبيه تلقائي عند وصول الرصيد إلى هذا الحد أو انخفاضه عنه.</p></label><label><span className="field-label">سعر شراء القطعة</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={defaultUnitCost} onChange={event => setDefaultUnitCost(event.target.value)} placeholder="0" /><p className="mt-1 text-xs text-muted-foreground">يُستخدم تلقائيًا عند تسجيل الوارد لخصم التكلفة من الخزينة.</p></label><label className="sm:col-span-2"><span className="field-label">ملاحظات</span><textarea className="field-textarea" value={itemNotes} onChange={event => setItemNotes(event.target.value)} placeholder="المقاس أو المورد أو أي ملاحظة مفيدة" /></label></div><div className="sticky bottom-0 flex justify-end gap-3 bg-background/95 pt-2 backdrop-blur-sm"><Button type="button" variant="outline" onClick={() => setItemDialog(false)} className="rounded-xl">إلغاء</Button><Button type="submit" disabled={createItem.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800">{createItem.isPending ? "جارٍ الحفظ…" : "إضافة الصنف"}</Button></div></form></DialogContent></Dialog>
      <Dialog open={Boolean(movementItem)} onOpenChange={open => !open && setMovementItem(null)}><DialogContent dir="rtl" className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col overflow-hidden sm:max-w-2xl"><DialogHeader className="shrink-0"><DialogTitle>{movementType === "outgoing" ? "صرف صنف من المخزن" : "إضافة وارد للمخزن"}: {movementItem?.name}</DialogTitle><DialogDescription>سجّل نوع الحركة والكمية والتكلفة والتفاصيل اللازمة لحفظ حركة المخزن.</DialogDescription></DialogHeader><form onSubmit={submitMovement} className="min-h-0 flex-1 grid gap-4 overflow-y-auto overscroll-contain py-2 pl-1 pr-1 sm:grid-cols-2"><label><span className="field-label">نوع الحركة</span><select className="field-input" value={movementType} onChange={event => setMovementType(event.target.value as "incoming" | "outgoing")}><option value="incoming">وارد</option><option value="outgoing">منصرف</option></select></label><label><span className="field-label">الكمية</span><input type="number" min="1" className="field-input" value={quantity} onChange={event => { setQuantity(event.target.value); clearMovementError("quantity"); }} aria-invalid={Boolean(movementErrors.quantity)} aria-describedby={movementErrors.quantity ? "movement-quantity-error" : undefined} />{movementErrors.quantity ? <p id="movement-quantity-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">{movementErrors.quantity}</p> : null}</label>{movementType === "incoming" ? <label><span className="field-label">سعر شراء القطعة</span><input type="number" min="0" step="1" inputMode="numeric" className="field-input" value={unitCost} onChange={event => { setUnitCost(event.target.value); clearMovementError("unitCost"); }} aria-invalid={Boolean(movementErrors.unitCost)} aria-describedby={movementErrors.unitCost ? "unit-cost-error" : undefined} />{movementErrors.unitCost ? <p id="unit-cost-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">{movementErrors.unitCost}</p> : null}<p className="mt-1 text-xs text-muted-foreground">سيُخصم إجمالي الكمية × السعر من الخزينة تلقائيًا.</p><p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-extrabold text-emerald-800">إجمالي الخصم المتوقع: {formatMoney(Math.max(0, Number(quantity) || 0) * Math.max(0, Number(unitCost) || 0))}</p></label> : null}<label><span className="field-label">تاريخ الحركة</span><input type="datetime-local" className="field-input" value={movementDate} onChange={event => { setMovementDate(event.target.value); clearMovementError("movementDate"); }} aria-invalid={Boolean(movementErrors.movementDate)} aria-describedby={movementErrors.movementDate ? "movement-date-error" : undefined} />{movementErrors.movementDate ? <p id="movement-date-error" role="alert" className="mt-1 text-xs font-semibold text-red-600">{movementErrors.movementDate}</p> : null}</label><label><span className="field-label">اسم الفني المستلم</span><select aria-label="اسم الفني المستلم" className="field-input" value={technicianName} onChange={event => setTechnicianName(event.target.value)}><option value="">اختر الفني (اختياري للمنصرف)</option>{visibleTechnicians.map(technician => <option key={technician.id} value={technician.name ?? ""}>{technician.name ?? "فني بدون اسم"}</option>)}</select></label><label className="sm:col-span-2"><span className="field-label">ملاحظات</span><textarea className="field-textarea" value={movementNotes} onChange={event => setMovementNotes(event.target.value)} /></label><div className="sticky bottom-0 flex justify-end gap-3 bg-background/95 pt-2 backdrop-blur-sm sm:col-span-2"><Button type="button" variant="outline" onClick={() => setMovementItem(null)} className="rounded-xl">إلغاء</Button><Button type="submit" disabled={createMovement.isPending} className="rounded-xl bg-teal-700 hover:bg-teal-800">{createMovement.isPending ? "جارٍ الحفظ…" : "حفظ الحركة"}</Button></div></form></DialogContent></Dialog>
    </div>
  );
}


function formatMoney(amount: number) { return formatAppMoney(Number(amount || 0)); }
function latestPurchaseUnitCost(itemId: number, movements: Array<{ inventoryItemId: number; movementType: string; unitCost?: number | null }>) { return movements.find(movement => movement.inventoryItemId === itemId && movement.movementType === "incoming" && (movement.unitCost ?? 0) > 0)?.unitCost ?? 0; }
function InventorySummaryCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "teal" | "amber" | "sky" | "violet" }) { const tones = { teal: "border-teal-200 bg-teal-50 text-teal-950", amber: "border-amber-200 bg-amber-50 text-amber-950", sky: "border-sky-200 bg-sky-50 text-sky-950", violet: "border-violet-200 bg-violet-50 text-violet-950" }; return <article className={`min-h-28 rounded-2xl border p-4 shadow-sm ${tones[tone]}`}><p className="text-xs font-bold opacity-75">{label}</p><p className="mt-2 text-xl font-black">{value}</p><p className="mt-1 text-[11px] opacity-70">{hint}</p></article>; }
function InventoryDecisionCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: "teal" | "amber" | "green" }) { const tones = { teal: "border-teal-200 bg-teal-50 text-teal-950", amber: "border-amber-200 bg-amber-50 text-amber-950", green: "border-emerald-200 bg-emerald-50 text-emerald-950" }; return <article className={`min-h-36 rounded-2xl border p-4 shadow-sm ${tones[tone]}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold opacity-70">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div><span className="rounded-xl bg-white/80 p-2.5 shadow-sm">{icon}</span></div><p className="mt-3 truncate text-xs font-bold opacity-70" title={detail}>{detail}</p></article>; }
function balanceTextClass(balance: number, reorderLevel: number | null | undefined = 2) { const level = reorderLevel ?? 2; return balance <= 0 ? "text-rose-700" : balance <= level ? "text-amber-700" : "text-emerald-700"; }
function StockBadge({ balance, reorderLevel = 2 }: { balance: number; reorderLevel?: number | null }) { const level = reorderLevel ?? 2; return <Badge className={balance <= 0 ? "bg-rose-100 text-rose-800 hover:bg-rose-100" : balance <= level ? "bg-amber-100 text-amber-800 hover:bg-amber-100" : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"}>{balance <= 0 ? "غير متوفر" : balance <= level ? "رصيد منخفض" : "متوفر"}</Badge>; }
function inventoryVisual(category?: string | null, name?: string) {
  const value = `${category ?? ""} ${name ?? ""}`;
  if (value.includes("مبرد") || value.includes("ثلاج")) return { icon: Refrigerator, tone: "bg-sky-100 text-sky-700" };
  if (value.includes("قارور") || value.includes("زجاج") || value.includes("عبو")) return { icon: Droplets, tone: "bg-cyan-100 text-cyan-700" };
  if (value.includes("فلتر") || value.includes("شمع") || value.includes("ممبرين")) return { icon: Filter, tone: "bg-teal-100 text-teal-700" };
  if (value.includes("ثلج") || value.includes("تبريد")) return { icon: Snowflake, tone: "bg-indigo-100 text-indigo-700" };
  return { icon: PackageSearch, tone: "bg-violet-100 text-violet-700" };
}
function InventoryVisual({ category, name, customEmoji, imageUrl, compact = false }: { category?: string | null; name?: string; customEmoji?: string | null; imageUrl?: string | null; compact?: boolean }) { const visual = inventoryVisual(category, name); const Icon = visual.icon; return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${compact ? "h-8 w-8 rounded-xl" : "h-11 w-11 rounded-2xl"} ${visual.tone}`}>{imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : customEmoji ? <span className={`${compact ? "text-lg" : "text-2xl"} leading-none`}>{customEmoji}</span> : <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />}</span>; }
function InventoryTableRow({ item, onDetails, onMovement, onIncoming, onDelete, selected }: { item: { id: number; name: string; category?: string | null; customEmoji?: string | null; imageUrl?: string | null; notes: string | null; openingQuantity: number; currentBalance: number; reorderLevel?: number | null; defaultUnitCost?: number | null; createdAt?: Date | string | null }; onDetails: () => void; onMovement: () => void; onIncoming: () => void; onDelete: () => void; selected?: boolean }) {
  return <tr data-inventory-item-id={item.id} className={`inventory-item-row cursor-pointer transition-[background-color,box-shadow] duration-500 ease-out ${selected ? "inventory-item-row-selected bg-orange-100 ring-2 ring-inset ring-orange-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,.45)]" : "hover:bg-teal-50/45"}`} onClick={event => { if ((event.target as HTMLElement).closest("button")) return; onDetails(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDetails(); } }} role="button" tabIndex={0} title="اضغط لعرض كل بيانات الصنف">
    <td className="px-5 py-4"><div className="flex items-center gap-3"><InventoryVisual category={item.category} name={item.name} customEmoji={item.customEmoji} imageUrl={item.imageUrl} /><div><button type="button" onClick={onDetails} className="mt-1 text-right text-base font-extrabold text-teal-950 underline-offset-4 hover:underline">{item.name}</button><p className="mt-1 text-xs font-bold text-teal-700">{item.category || "عام"}</p><p className="mt-1 text-xs text-muted-foreground">أضيف في: {formatDate(item.createdAt)}</p>{item.notes ? <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{item.notes}</p> : null}</div></div></td>
    <td className="px-5 py-4">{item.openingQuantity}</td><td className={`px-5 py-4 text-lg font-extrabold ${balanceTextClass(item.currentBalance, item.reorderLevel)}`}>{item.currentBalance}</td><td className="px-5 py-4"><StockBadge balance={item.currentBalance} reorderLevel={item.reorderLevel} /></td><td className="px-5 py-4"><Button size="sm" variant="outline" onClick={onIncoming} className="rounded-lg border-emerald-200 text-emerald-800 hover:bg-emerald-50"><PackagePlus className="ml-1 h-4 w-4" />إضافة وارد</Button><Button size="sm" variant="outline" onClick={onMovement} className="mr-2 rounded-lg border-teal-700/20 text-teal-800 hover:bg-teal-50"><PackagePlus className="ml-1 h-4 w-4" />صرف صنف</Button><Button size="sm" variant="outline" onClick={onDelete} className="mr-2 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50">حذف</Button></td>
  </tr>;
}
function EmptyInventoryRow({ isLoading }: { isLoading: boolean }) { return <tr><td colSpan={5} className="p-14 text-center"><Boxes className="mx-auto h-8 w-8 text-teal-200" /><p className="mt-3 text-sm text-muted-foreground">{isLoading ? "جارٍ تحميل المخزن…" : "لا توجد أصناف مسجلة حتى الآن."}</p></td></tr>; }
function EmptyInventoryCard({ isLoading }: { isLoading: boolean }) { return <div className="p-12 text-center"><Boxes className="mx-auto h-8 w-8 text-teal-200" /><p className="mt-3 text-sm text-muted-foreground">{isLoading ? "جارٍ تحميل المخزن…" : "لا توجد أصناف مسجلة حتى الآن."}</p></div>; }
function MovementType({ movementType }: { movementType: "incoming" | "outgoing" }) { return movementType === "incoming" ? <span className="inline-flex items-center gap-1 text-sm font-bold text-teal-700"><ArrowDownLeft className="h-4 w-4" />وارد</span> : <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-700"><ArrowUpRight className="h-4 w-4" />منصرف</span>; }
function MovementTableRow({ movement, onDelete }: { movement: { id: number; movementDate: Date; inventoryItemName: string; movementType: "incoming" | "outgoing"; quantity: number; unitCost?: number | null; technicianName: string | null; customerName?: string | null; notes: string | null }; onDelete: () => void }) { const totalCost = (movement.unitCost ?? 0) * movement.quantity; return <tr><td className="px-5 py-4 text-sm">{formatDate(movement.movementDate)}</td><td className="px-5 py-4 font-bold text-teal-950">{movement.inventoryItemName}</td><td className="px-5 py-4"><MovementType movementType={movement.movementType} /></td><td className="px-5 py-4 font-extrabold">{movement.quantity}</td><td className="px-5 py-4 text-sm">{movement.movementType === "incoming" ? <div><p className="font-bold text-violet-800">سعر الوحدة: {formatMoney(movement.unitCost ?? 0)}</p><p className="mt-1 text-xs text-violet-700">الإجمالي: {formatMoney(totalCost)}</p></div> : <span className="text-muted-foreground">—</span>}</td><td className="px-5 py-4 text-sm">{movement.technicianName || "—"}</td><td className="px-5 py-4 text-sm">{movement.customerName || "—"}</td><td className="max-w-64 truncate px-5 py-4 text-sm text-muted-foreground">{movement.notes || "—"}</td><td className="px-5 py-4"><Button size="sm" variant="outline" onClick={onDelete} className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50">حذف</Button></td></tr>; }
