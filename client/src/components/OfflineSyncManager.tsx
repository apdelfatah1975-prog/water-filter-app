import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  getPendingCustomers,
  getPendingOperationCount,
  getPendingVisits,
  getPendingVisitDeletes,
  getPendingWorkOrderUpdates,
  getPendingWorkOrderProofs,
  getPendingCash,
  getPendingInventory,
  removePendingCash,
  removePendingInventory,
  removePendingCustomer,
  removePendingVisit,
  removePendingVisitDelete,
  removePendingWorkOrderUpdate,
  removePendingWorkOrderProof,
  replaceOfflineCustomerId,
} from "@/lib/offlineSync";
import { CloudOff, CloudUpload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function formatSyncError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/network|fetch|timeout|offline|failed to fetch/i.test(raw)) return "تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.";
  if (/unauthorized|forbidden|401|403/i.test(raw)) return "انتهت صلاحية الجلسة أو لا تملك صلاحية المزامنة. سجّل الدخول مجددًا.";
  if (/duplicate|already exists|conflict/i.test(raw)) return "تعذر حفظ إحدى العمليات لأنها موجودة مسبقًا. راجع السجل قبل إعادة المحاولة.";
  return "تعذر مزامنة البيانات بسبب خطأ غير متوقع. أعد المحاولة، وإذا استمر الخطأ تواصل مع الدعم.";
}

export function OfflineSyncManager() {
  const { user } = useAuth();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const utils = trpc.useUtils();
  const { mutateAsync: syncCustomer } = trpc.filters.customers.create.useMutation();
  const { mutateAsync: syncVisit } = trpc.filters.visits.create.useMutation();
  const { mutateAsync: deleteVisit } = trpc.filters.visits.delete.useMutation();
  const { mutateAsync: syncWorkOrderUpdate } = trpc.filters.workOrders.updateStatus.useMutation();
  const { mutateAsync: syncWorkOrderProof } = trpc.filters.workOrders.addProof.useMutation();
  const { mutateAsync: syncCash } = trpc.filters.cash.create.useMutation();
  const { mutateAsync: syncInventoryItem } = trpc.filters.inventory.createItem.useMutation();
  const { mutateAsync: syncInventoryMovement } = trpc.filters.inventory.createMovement.useMutation();
  const { mutateAsync: deleteCash } = trpc.filters.cash.delete.useMutation();
  const { mutateAsync: deleteInventoryItem } = trpc.filters.inventory.deleteItem.useMutation();
  const { mutateAsync: deleteInventoryMovement } = trpc.filters.inventory.deleteMovement.useMutation();

  const refreshCount = useCallback(() => {
    setPendingCount(user ? getPendingOperationCount(user.id) : 0);
  }, [user]);

  const syncPendingOperations = useCallback(async () => {
    if (!user || !navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    window.dispatchEvent(new CustomEvent("purepoint-offline-sync-start"));
    setSyncFailed(false);
    setSyncError(null);
    let syncedCount = 0;
    let batchFailed = false;
    const customerIdMap = new Map<number, number>();
    for (const customer of getPendingCustomers(user.id)) {
      try {
        const result = await syncCustomer({
          name: customer.name,
          phone: customer.phone,
          address: customer.address ?? null,
          latitude: customer.latitude ?? null,
          longitude: customer.longitude ?? null,
          notes: customer.notes ?? null,
          firstVisitType: customer.firstVisitType,
          firstVisitDate: customer.firstVisitDate ? new Date(customer.firstVisitDate) : undefined,
          firstTechnicianName: customer.firstTechnicianName ?? null,
          firstSalesAgentName: customer.firstSalesAgentName ?? null,
          firstFilterCount: customer.firstFilterCount ?? 0,
          firstVisitNotes: customer.firstVisitNotes ?? null,
          firstCollectedAmount: customer.firstCollectedAmount ?? 0,
          firstCollectedCurrency: "SAR",
          items: customer.firstVisitItems ?? [],
          clientOperationId: customer.clientOperationId,
        });
        customerIdMap.set(customer.localId, result.id);
        replaceOfflineCustomerId(customer.localId, result.id);
        removePendingCustomer(user.id, customer.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    for (const visit of getPendingVisits(user.id)) {
      try {
        const customerId = customerIdMap.get(visit.customerId) ?? visit.customerId;
        if (customerId <= 0) break;
        await syncVisit({
          customerId,
          visitType: visit.visitType,
          visitDate: new Date(visit.visitDate),
          notes: visit.notes,
          technicianName: visit.technicianName ?? null,
          salesAgentName: visit.salesAgentName ?? null,
          filterCount: visit.filterCount ?? 0,
          visitResult: visit.visitResult ?? null,
          collectedAmount: visit.collectedAmount ?? 0,
          collectedCurrency: visit.collectedCurrency ?? "SAR",
          items: visit.items ?? [],
          clientOperationId: visit.clientOperationId,
        });
        removePendingVisit(user.id, visit.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    for (const operation of getPendingVisitDeletes(user.id)) {
      try {
        await deleteVisit({ id: operation.id, pin: operation.pin });
        removePendingVisitDelete(user.id, operation.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    for (const operation of getPendingWorkOrderUpdates(user.id)) {
      try {
        await syncWorkOrderUpdate({
          id: operation.id,
          status: operation.status,
          visitResult: operation.visitResult ?? null,
          notes: operation.notes ?? null,
          executionOutcome: operation.executionOutcome ?? null,
          notCompletedReason: operation.notCompletedReason ?? null,
          collectedAmount: operation.collectedAmount ?? 0,
          collectedCurrency: operation.collectedCurrency ?? "SAR",
          nextVisitDate: operation.nextVisitDate ? new Date(operation.nextVisitDate) : undefined,
          followUpDays: operation.followUpDays,
          items: operation.items ?? [],
        });
        removePendingWorkOrderUpdate(user.id, operation.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    for (const operation of getPendingWorkOrderProofs(user.id)) {
      try {
        await syncWorkOrderProof({ visitId: operation.visitId, kind: operation.kind, dataUrl: operation.dataUrl });
        removePendingWorkOrderProof(user.id, operation.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    const inventoryIdMap = new Map<number, number>();
    for (const operation of getPendingInventory(user.id)) {
      try {
        if (operation.entity === "item") {
          const result = await syncInventoryItem({ name: operation.name, category: operation.category ?? "عام", unit: operation.unit ?? "قطعة", reorderLevel: operation.reorderLevel ?? 2, defaultUnitCost: operation.defaultUnitCost ?? 0, openingQuantity: operation.openingQuantity, notes: operation.notes ?? null, clientOperationId: operation.clientOperationId });
          inventoryIdMap.set(operation.localId ?? -Date.now(), result.id);
        } else if (operation.entity === "movement") {
          const inventoryItemId = inventoryIdMap.get(operation.inventoryItemId) ?? operation.inventoryItemId;
          if (inventoryItemId <= 0) throw new Error("الصنف المحلي لم تتم مزامنته بعد");
          await syncInventoryMovement({ inventoryItemId, movementType: operation.movementType, quantity: operation.quantity, unitCost: operation.unitCost, currency: operation.currency, movementDate: new Date(operation.movementDate), technicianName: operation.technicianName ?? null, notes: operation.notes ?? null, clientOperationId: operation.clientOperationId });
        } else if (operation.entity === "inventoryItem" && operation.id > 0) {
          await deleteInventoryItem({ id: operation.id, pin: operation.pin });
        } else if (operation.entity === "inventoryMovement" && operation.id > 0) {
          await deleteInventoryMovement({ id: operation.id, pin: operation.pin });
        } else {
          removePendingInventory(user.id, operation.clientOperationId);
          continue;
        }
        removePendingInventory(user.id, operation.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    for (const operation of getPendingCash(user.id)) {
      try {
        if ("transactionType" in operation) await syncCash({ transactionType: operation.transactionType, currency: operation.currency, amount: operation.amount, category: operation.category, transactionDate: new Date(operation.transactionDate), recipientName: operation.recipientName ?? null, notes: operation.notes ?? null, clientOperationId: operation.clientOperationId });
        else await deleteCash({ id: operation.id, pin: operation.pin });
        removePendingCash(user.id, operation.clientOperationId);
        syncedCount += 1;
      } catch (error) {
        batchFailed = true;
        setSyncFailed(true);
        setSyncError(formatSyncError(error));
        break;
      }
    }
    setSyncing(false);
    syncingRef.current = false;
    window.dispatchEvent(new CustomEvent("purepoint-offline-sync-finished"));
    refreshCount();
    if (syncedCount > 0 && !batchFailed) {
      toast.success(`تمت مزامنة ${syncedCount} ${syncedCount === 1 ? "عملية" : "عمليات"} بنجاح بعد عودة الإنترنت.`);
    } else if (batchFailed) {
      toast.error("فشلت مزامنة بعض البيانات. راجع الرسالة الظاهرة وأعد المحاولة.");
    }
    await Promise.all([
      utils.filters.dashboard.invalidate(),
      utils.filters.customers.list.invalidate(),
      utils.filters.customers.get.invalidate(),
      utils.filters.reminders.due.invalidate(),
      utils.filters.workOrders.list.invalidate(),
      utils.filters.cash.summary.invalidate(),
      utils.filters.inventory.summary.invalidate(),
    ]);
  }, [deleteCash, deleteInventoryItem, deleteInventoryMovement, deleteVisit, refreshCount, syncCash, syncCustomer, syncInventoryItem, syncInventoryMovement, syncVisit, syncWorkOrderUpdate, user, utils]);

  useEffect(() => {
    const requestBackgroundSync = () => {
      if (!("serviceWorker" in navigator) || !navigator.onLine) return;
      void navigator.serviceWorker.ready.then(registration => {
        const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
        return syncManager?.register("purepoint-offline-sync");
      }).catch(() => undefined);
    };
    const goOnline = () => { setOnline(true); requestBackgroundSync(); void syncPendingOperations(); };
    const goOffline = () => setOnline(false);
    const retryRequested = () => { requestBackgroundSync(); void syncPendingOperations(); };
    const serviceWorkerMessage = (event: MessageEvent) => { if (event.data?.type === "purepoint-offline-sync-request") void syncPendingOperations(); };
    const queueChanged = () => { refreshCount(); requestBackgroundSync(); };
    refreshCount();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("purepoint-offline-sync-request", retryRequested);
    window.addEventListener("purepoint-offline-queue-changed", queueChanged);
    navigator.serviceWorker?.addEventListener("message", serviceWorkerMessage);
    if (navigator.onLine) { requestBackgroundSync(); void syncPendingOperations(); }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("purepoint-offline-sync-request", retryRequested);
      window.removeEventListener("purepoint-offline-queue-changed", queueChanged);
      navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessage);
    };
  }, [refreshCount, syncPendingOperations]);

  if (online && pendingCount === 0) return null;
  const message = !online
    ? pendingCount
      ? `${pendingCount} عملية محفوظة وستتزامن عند عودة الإنترنت`
      : "وضع دون إنترنت"
    : syncing
      ? `جارٍ مزامنة ${pendingCount} عملية محفوظة…`
      : syncFailed
        ? syncError ?? `تعذر مزامنة ${pendingCount} عملية. أعد المحاولة.`
        : `${pendingCount} عملية بانتظار المزامنة`;
  return (
    <div className={`fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-xs font-bold shadow-lg ${!online ? "bg-amber-500 text-amber-950" : syncFailed ? "bg-red-600 text-white" : "bg-teal-700 text-white"}`} role="status" aria-live="polite" aria-busy={syncing} title="حالة المزامنة">
      {online ? <CloudUpload className={`h-4 w-4 shrink-0 ${syncing ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} /> : <CloudOff className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{message}</span>
      {syncFailed && !syncing && (
        <button type="button" onClick={() => window.dispatchEvent(new Event("purepoint-offline-sync-request"))} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2 text-[11px] font-black hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white" aria-label="إعادة محاولة مزامنة البيانات">
          <CloudUpload className="h-3.5 w-3.5" />إعادة المحاولة
        </button>
      )}
      {syncing && (
        <span className="basis-full space-y-1" aria-label="تقدم المزامنة">
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/25">
            <span className="block h-full w-2/5 rounded-full bg-white motion-safe:animate-pulse motion-reduce:animate-none" />
          </span>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-white/85">
            <span className="h-1 w-1 rounded-full bg-white motion-safe:animate-bounce motion-reduce:animate-none" />
            <span className="h-1 w-1 rounded-full bg-white motion-safe:animate-bounce motion-reduce:animate-none [animation-delay:120ms]" />
            <span className="h-1 w-1 rounded-full bg-white motion-safe:animate-bounce motion-reduce:animate-none [animation-delay:240ms]" />
            <span>يتم إرسال العمليات المحفوظة بالتتابع</span>
          </span>
        </span>
      )}
    </div>
  );
}
