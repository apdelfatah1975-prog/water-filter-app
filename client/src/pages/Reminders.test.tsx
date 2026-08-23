import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Reminders from "./Reminders";

const mocks = vi.hoisted(() => ({
  due: vi.fn(),
  alerts: vi.fn(),
  settings: vi.fn(),
  updateMutation: vi.fn(),
  deleteMutation: vi.fn(),
  invalidate: vi.fn(),
  location: vi.fn(),
  open: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    filters: {
      reminders: {
        due: { useQuery: mocks.due },
        alerts: { useQuery: mocks.alerts },
        updateStatus: { useMutation: mocks.updateMutation },
        delete: { useMutation: mocks.deleteMutation },
      },
      notifications: {
        settings: { useQuery: mocks.settings },
      },
    },
    useUtils: () => ({
      filters: {
        reminders: {
          due: { invalidate: mocks.invalidate },
          alerts: { invalidate: mocks.invalidate },
        },
        dashboard: { invalidate: mocks.invalidate },
        customers: { list: { invalidate: mocks.invalidate } },
      },
    }),
  },
}));

vi.mock("@/components/NotificationSettingsCard", () => ({
  NotificationSettingsCard: () => <div data-testid="notification-settings" />,
}));

vi.mock("wouter", () => ({ useLocation: () => ["/reminders", mocks.location] }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo } }));

function reminder(reminderDate: Date) {
  return {
    id: 41,
    customerId: 7,
    reminderDate,
    daysOverdue: 0,
    status: "pending",
    lastServiceVisitType: "maintenance",
    lastServiceVisitDate: new Date(reminderDate.getTime() - 120 * 86_400_000),
    customer: {
      id: 7,
      name: "أحمد العميل",
      phone: "01008797774",
      address: "القاهرة",
      latitude: null,
      longitude: null,
      customerCode: "C-000007",
    },
  };
}

describe("حالات واتساب اليدوية في التذكيرات", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "open").mockImplementation(mocks.open);
    mocks.due.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.alerts.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.settings.mockReturnValue({ data: { companyWhatsAppPhone: "201155566677" }, isLoading: false, isError: false });
    mocks.updateMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.deleteMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("يعرض رقم واتساب الشركة المحفوظ بدل الرقم الثابت", () => {
    render(<Reminders />);

    expect(screen.getByText(/رقم واتساب الشركة:/)).toBeTruthy();
    expect(screen.getByText("201155566677")).toBeTruthy();
    expect(screen.queryByText("01008797774")).toBeNull();
  });

  it("يبقي التذكير ظاهرًا ويسجل تجهيز رسالة ما قبل الموعد", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const item = reminder(tomorrow);
    mocks.due.mockReturnValue({ data: [item], isLoading: false, isError: false });

    render(<Reminders />);

    expect(screen.getByText("أحمد العميل")).toBeTruthy();
    const button = screen.getByRole("button", { name: "واتساب قبل الموعد" });
    fireEvent.click(button);

    expect(screen.getByText("أحمد العميل")).toBeTruthy();
    expect(window.localStorage.getItem("water-filter-whatsapp-reminder-state")).toContain("41:before");
    expect(mocks.open).toHaveBeenCalledWith(expect.stringContaining("wa.me/201008797774"), "_blank", "noopener,noreferrer");
  });

  it("يعرض رسالة إنشاء الموعد الجديد بعد تسجيل إتمام الزيارة", () => {
    const item = reminder(new Date(Date.now() - 86_400_000));
    const mutate = vi.fn();
    mocks.due.mockReturnValue({ data: [item], isLoading: false, isError: false });
    mocks.updateMutation.mockReturnValue({
      mutate,
      isPending: false,
      options: { onSuccess: (result: { nextVisitCreated: boolean }) => mocks.toastSuccess(result.nextVisitCreated ? "تم تسجيل الزيارة وإنشاء موعد المتابعة القادم بعد ١٢٠ يومًا" : "تم تحديث حالة التذكير") },
    });

    render(<Reminders />);
    fireEvent.click(screen.getByRole("button", { name: "تمت" }));
    fireEvent.change(screen.getByPlaceholderText("••••"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));

    expect(mutate).toHaveBeenCalledWith({ id: 41, status: "completed", pin: "1234" });
  });

  it("يخفي رسالة يوم الموعد بعد التأكيد ويستعيد الحالة بعد إعادة التحميل", () => {
    const today = new Date();
    const item = reminder(today);
    mocks.due.mockReturnValue({ data: [item], isLoading: false, isError: false });

    const firstRender = render(<Reminders />);
    expect(screen.getByRole("button", { name: "واتساب اليوم" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تم تأكيد العميل" }));

    expect(screen.getByText("تم تسجيل تأكيد العميل")).toBeTruthy();
    expect(screen.getByText("أحمد العميل")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "واتساب اليوم" })).toBeNull();

    firstRender.unmount();
    render(<Reminders />);

    expect(screen.getByText("أحمد العميل")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "واتساب اليوم" })).toBeNull();
    expect(screen.getByText("تم تسجيل تأكيد العميل")).toBeTruthy();
  });
});

export {};
