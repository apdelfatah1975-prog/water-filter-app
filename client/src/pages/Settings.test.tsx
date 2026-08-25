import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  location: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    filters: {
      notifications: {
        setPin: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
        verifyPin: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false }) },
      },
      customers: {
        create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        deleteAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        deleteAllData: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        seedPerformanceCustomers: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        deletePerformanceCustomers: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      visits: { create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      cash: { create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      inventory: {
        createItem: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        createMovement: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        summary: { useQuery: () => ({ data: { items: [] }, isLoading: false, refetch: vi.fn() }) },
        updateAppearance: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
    useUtils: () => ({ filters: { customers: { list: { invalidate: vi.fn() } }, dashboard: { invalidate: vi.fn() }, invalidate: vi.fn() } }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("wouter", () => ({ useLocation: () => ["/settings", mocks.location] }));

describe("صفحة الإعدادات", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("تفتح بطاقتا واتساب تفاصيلهما عند النقر وتبقى حالة API غير مهيأة", () => {
    render(<Settings />);

    fireEvent.click(screen.getByTestId("whatsapp-manual-card"));
    expect(screen.getByTestId("whatsapp-card-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "فتح نموذج العميل" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("whatsapp-official-card"));
    expect(screen.getByTestId("whatsapp-card-panel").textContent).toContain("غير مهيأ");
    expect(screen.getByText("Access Token")).toBeTruthy();
  });

  it("يفتح شاشة حالة المزامنة من قسم الاتصال والمزامنة", () => {
    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "فتح حالة المزامنة" }));
    expect(mocks.location).toHaveBeenCalledWith("/pending-operations");
  });

  it("تعرض إعداد الرقم السري وتسمح بإرساله من صفحة الإعدادات", () => {
    render(<Settings />);

    expect(screen.getByRole("heading", { name: "الإعدادات" })).toBeTruthy();
    expect(screen.getByText("الرقم السري للحماية")).toBeTruthy();
    expect(screen.getByText("اختبار أداء التطبيق")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إنشاء 1000 عميل تجريبي" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حذف كل البيانات التجريبية" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("اتركه فارغًا عند الإعداد لأول مرة"), { target: { value: "1234" } });
    fireEvent.change(screen.getByPlaceholderText("4 أحرف أو أرقام على الأقل"), { target: { value: "5678" } });
    fireEvent.change(screen.getByPlaceholderText("أعد كتابة الرقم السري"), { target: { value: "5678" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الرقم السري" }));

    expect(mocks.mutate).toHaveBeenCalledWith({ currentPin: "1234", newPin: "5678" });
  });
});

export {};
