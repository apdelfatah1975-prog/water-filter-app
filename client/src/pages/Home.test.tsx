import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  cashSummary: vi.fn(),
  backupStatus: vi.fn(),
  backupCreateNow: vi.fn(),
  dashboardInvalidate: vi.fn(),
  setLocation: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    filters: {
      dashboard: { useQuery: mocks.dashboard },
      cash: { summary: { useQuery: mocks.cashSummary } },
      backup: {
        status: { useQuery: mocks.backupStatus },
        createNow: { useMutation: mocks.backupCreateNow },
      },
    },
    useUtils: () => ({ filters: { dashboard: { invalidate: mocks.dashboardInvalidate }, backup: { status: { invalidate: vi.fn() } } } }),
  },
}));

vi.mock("@/components/ReminderAlertBanner", () => ({
  ReminderAlertBanner: () => null,
}));

vi.mock("sonner", () => ({
  toast: { warning: mocks.toastWarning },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.setLocation],
}));

describe("بطاقة رصيد الخزينة في لوحة التحكم", () => {
  beforeEach(() => {
    mocks.setLocation.mockReset();
    mocks.dashboardInvalidate.mockReset();
    mocks.toastWarning.mockReset();
    localStorage.removeItem("purepoint-low-stock-alert");
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [],
        upcomingVisits: [],
        upcomingFollowUps: [],
        dueReminders: [],
        cash: { incomeTotal: 250, expenseTotal: 0, balance: 250, summaries: [] },
        inventory: { totalItems: 0, lowStockCount: 0, lowStock: [] },
      },
    });
    mocks.cashSummary.mockReturnValue({ data: { balance: 250 } });
    mocks.backupStatus.mockReturnValue({ data: { generatedAt: null, downloadUrl: null }, isLoading: false });
    mocks.backupCreateNow.mockReturnValue({ isPending: false, isSuccess: false, mutate: vi.fn() });
  });

  afterEach(() => {
    cleanup();
  });

  it("تعرض قسم الزيارات القادمة وقسم المتابعة المستحقة في التخطيط السابق", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [],
        upcomingVisits: [{ id: 21, customerId: 7, visitDate: new Date(), visitType: "maintenance", customer: { name: "عميل قادم", customerCode: "٧" } }],
        upcomingFollowUps: [],
        dueReminders: [{ id: 22, customerId: 8, reminderDate: new Date(), daysOverdue: 2, customer: { name: "عميل مستحق", customerCode: "٨" } }],
        customerCount: 4,
        cash: { incomeTotal: 250, expenseTotal: 0, balance: 250, summaries: [] },
        inventory: { totalItems: 0, lowStockCount: 0, lowStock: [] },
      },
    });
    render(<Home />);
    expect(screen.getByText("الزيارات القادمة")).toBeTruthy();
    expect(screen.getByText("المتابعة المستحقة")).toBeTruthy();
    expect(screen.queryByText("تواصل الآن")).toBeNull();
    expect(screen.queryByText("تمت المتابعة")).toBeNull();
  });

  it("تعرض ملخص حالات أوامر الشغل وتفتح شاشة أوامر الفنيين", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [],
        upcomingVisits: [],
        upcomingFollowUps: [],
        dueReminders: [],
        cash: { incomeTotal: 250, expenseTotal: 0, balance: 250, summaries: [] },
        inventory: { totalItems: 0, lowStockCount: 0, lowStock: [] },
        workOrderSummary: { total: 8, assigned: 2, inProgress: 3, completed: 2, notCompleted: 1 },
      },
    });
    render(<Home />);
    expect(screen.getByRole("heading", { name: "متابعة أوامر الشغل" })).toBeTruthy();
    const completedButton = screen.getByRole("button", { name: "فتح أوامر مكتملة" });
    expect(completedButton).toBeTruthy();
    expect(completedButton.textContent).toContain("٢");
    fireEvent.click(screen.getByRole("button", { name: "فتح أوامر الفنيين" }));
    expect(mocks.setLocation).toHaveBeenCalledWith("/work-orders");
  });

  it("تشتق عداد المخزن من الأصناف الفعلية حتى عند اختلاف totalItems", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [], upcomingVisits: [], upcomingFollowUps: [], dueReminders: [],
        cash: { incomeTotal: 0, expenseTotal: 0, balance: 0, summaries: [] },
        inventory: { totalItems: 99, lowStockCount: 0, lowStock: [], items: [{ id: 1, name: "شمعة", currentBalance: 4, reorderLevel: 2 }, { id: 2, name: "ممبرين", currentBalance: 3, reorderLevel: 2 }] },
      },
    });
    render(<Home />);
    const inventoryCard = screen.getByRole("button", { name: "فتح تفاصيل أصناف بالمخزن" });
    expect(inventoryCard.textContent).toContain("2");
  });

  it("تعتمد لوحة المتابعة على إعادة الجلب المركزي ولا تستجيب لطابور offline القديم", () => {
    render(<Home />);
    const options = mocks.dashboard.mock.calls.at(-1)?.[1] as { refetchInterval?: number; networkMode?: string };
    expect(options.refetchInterval).toBe(8_000);
    expect(options.networkMode).toBe("online");
    window.dispatchEvent(new Event("purepoint-offline-queue-changed"));
    expect(mocks.dashboardInvalidate).not.toHaveBeenCalled();
  });

  it("تعرض بطاقتي التسجيل وتوجههما للمسارات الصحيحة عند النقر", () => {
    render(<Home />);
    const customerButton = screen.getByRole("button", { name: "تسجيل عميل جديد" });
    const visitButton = screen.getByRole("button", { name: "تسجيل زيارة جديدة" });
    expect(customerButton.hasAttribute("disabled")).toBe(false);
    expect(visitButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(customerButton);
    expect(mocks.setLocation).toHaveBeenCalledWith("/customers/new");
    fireEvent.click(visitButton);
    expect(mocks.setLocation).toHaveBeenCalledWith("/customers/visit");
  });

  it("تنبه المستخدم تلقائيًا عند وصول صنف إلى الحد الأدنى", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [],
        upcomingVisits: [],
        upcomingFollowUps: [],
        dueReminders: [],
        cash: { incomeTotal: 250, expenseTotal: 0, balance: 250, summaries: [] },
        inventory: {
          totalItems: 1,
          lowStockCount: 1,
          lowStock: [{ id: 27, name: "فلتر جامبو", currentBalance: 2, reorderLevel: 2 }],
          items: [{ id: 27, name: "فلتر جامبو", currentBalance: 2, reorderLevel: 2 }],
        },
      },
    });
    render(<Home />);
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.stringContaining("فلتر جامبو"), expect.objectContaining({ description: expect.stringContaining("الحد الأدنى") }));
  });

  it("تعرض شارة حمراء بعدد الأصناف منخفضة الرصيد وتفتح المخزن عند الضغط على البطاقة", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [], upcomingVisits: [], upcomingFollowUps: [], dueReminders: [],
        cash: { incomeTotal: 0, expenseTotal: 0, balance: 0, summaries: [] },
        inventory: {
          totalItems: 2,
          lowStockCount: 2,
          lowStock: [{ id: 27, name: "فلتر جامبو", currentBalance: 1, reorderLevel: 2 }, { id: 28, name: "شمعة", currentBalance: 0, reorderLevel: 2 }],
          items: [{ id: 27, name: "فلتر جامبو", currentBalance: 1, reorderLevel: 2 }, { id: 28, name: "شمعة", currentBalance: 0, reorderLevel: 2 }],
        },
      },
    });
    render(<Home />);
    const badge = screen.getByTestId("dashboard-low-stock-badge");
    expect(badge.textContent).toContain("منخفض");
    expect(badge.textContent).toContain("2");
    expect(badge.getAttribute("aria-label")).toContain("أصناف منخفضة الرصيد");
    fireEvent.click(screen.getByRole("button", { name: "فتح تفاصيل أصناف بالمخزن" }));
    expect(mocks.setLocation).toHaveBeenCalledWith("/inventory");
  });

  it("لا تعرض شارة الرصيد المنخفض عندما تكون كل الأرصدة فوق الحد الأدنى", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [], upcomingVisits: [], upcomingFollowUps: [], dueReminders: [],
        cash: { incomeTotal: 0, expenseTotal: 0, balance: 0, summaries: [] },
        inventory: { totalItems: 1, lowStockCount: 0, lowStock: [], items: [{ id: 27, name: "فلتر جامبو", currentBalance: 4, reorderLevel: 2 }] },
      },
    });
    render(<Home />);
    expect(screen.queryByTestId("dashboard-low-stock-badge")).toBeNull();
  });

  it("تنتقل بطاقة صنف المخزن إلى تفاصيل الصنف المحدد", () => {
    mocks.dashboard.mockReturnValue({
      isLoading: false,
      data: {
        todayVisits: [],
        upcomingVisits: [],
        upcomingFollowUps: [],
        dueReminders: [],
        cash: { incomeTotal: 250, expenseTotal: 0, balance: 250, summaries: [] },
        inventory: {
          totalItems: 1,
          lowStockCount: 0,
          lowStock: [],
          items: [{ id: 27, name: "فلتر جامبو", currentBalance: 4, reorderLevel: 2 }],
        },
      },
    });
    render(<Home />);
    const itemCard = screen.getByRole("button", { name: "فتح تفاصيل فلتر جامبو" });
    fireEvent.click(itemCard);
    expect(mocks.setLocation).toHaveBeenCalledWith("/inventory?item=27");
  });

  it("تظهر كبطاقة تفاعلية وتنتقل إلى صفحة الخزينة عند الضغط", () => {
    render(<Home />);

    const cashCard = screen.getByRole("button", { name: "فتح تفاصيل رصيد الخزينة" });
    expect(cashCard.textContent).toContain("رصيد الخزينة");
    expect(cashCard.textContent).toContain("250");

    fireEvent.click(cashCard);
    expect(mocks.setLocation).toHaveBeenCalledWith("/cash");
  });

  it("تعرض زر سلة المحذوفات وعدد العناصر وتفتح الإعدادات", () => {
    localStorage.setItem("purepoint-trash-bin", JSON.stringify([
      { id: "customer-1", entityType: "customer", entityLabel: "عميل تجريبي", payload: {}, deletedAt: new Date().toISOString() },
      { id: "cash-2", entityType: "cash", entityLabel: "عملية خزينة", payload: {}, deletedAt: new Date().toISOString() },
    ]));
    render(<Home />);
    const trashButton = screen.getByRole("button", { name: "فتح سلة المحذوفات" });
    expect(trashButton.textContent).toContain("سلة المحذوفات");
    expect(trashButton.textContent).toContain("٢");
    fireEvent.click(trashButton);
    expect(mocks.setLocation).toHaveBeenCalledWith("/settings?section=trash");
  });
});
