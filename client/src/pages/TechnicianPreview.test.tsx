import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TechnicianPreview from "./TechnicianPreview";

const setLocation = vi.fn();
const mutate = vi.fn();
const refetch = vi.fn();
const inventoryItems = [{ id: 14, name: "شمعة 10 بوصة", unit: "قطعة", currentBalance: 5 }];

const orders = [
  {
    id: 7,
    status: "assigned",
    visitType: "maintenance",
    visitDate: new Date("2026-08-18T09:00:00Z"),
    visitResult: null,
    customer: { name: "أحمد محمد", phone: "0500000000", address: "حي النور", latitude: null, longitude: null },
  },
];

vi.mock("wouter", () => ({ useLocation: () => ["/technician-preview", setLocation] }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, name: "الفني التجريبي", role: "user" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ filters: { visits: { list: { invalidate: vi.fn() } }, dashboard: { invalidate: vi.fn() } } }),
    filters: {
      workOrders: {
        list: { useQuery: () => ({ data: orders, refetch }) },
        updateStatus: { useMutation: () => ({ mutate, isPending: false }) },
        addProof: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      inventory: { technicianSummary: { useQuery: () => ({ data: { items: inventoryItems } }) } },
      notifications: { settings: { useQuery: () => ({ data: { companyWhatsAppPhone: "0500000000" } }) } },
    },
  },
}));

describe("واجهة الفني وأوامر العمل", () => {
  afterEach(() => {
    cleanup();
    orders[0].status = "assigned";
    setLocation.mockReset();
    mutate.mockReset();
    refetch.mockReset();
  });

  it("تعرض بيانات العميل المسموحة وتحجب أسرار الشركة", () => {
    render(<TechnicianPreview />);
    expect(screen.getByText("أوامري فقط")).toBeTruthy();
    expect(screen.getByText("أحمد محمد")).toBeTruthy();
    expect(screen.getByText("أوامرك المسندة فقط")).toBeTruthy();
    expect(screen.queryByText("الخزينة العامة")).toBeNull();
    expect(screen.queryByText("تكلفة الشراء")).toBeNull();
    expect(screen.queryByText("تقارير الشركة")).toBeNull();
    expect(screen.queryByText("طلب الموقع")).toBeNull();
    expect(screen.queryByText("مشاركة الموقع")).toBeNull();
  });

  it("تنقل أمر العمل من مسند إلى في الطريق", () => {
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "في الطريق" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 7, status: "en_route" }));
  });

  it("تفتح نموذج الإغلاق للأمر الجاري وتعرض حقول النتيجة والتحصيل", () => {
    orders[0].status = "en_route";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    expect(screen.getByText("إغلاق أمر العمل")).toBeTruthy();
    expect(screen.getByLabelText("المبلغ المحصل")).toBeTruthy();
  });

  it("تعرض حقلي صورة قبل وبعد الصيانة عند تسجيل التنفيذ المكتمل", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    expect(screen.getByLabelText("صورة قبل الصيانة")).toBeTruthy();
    expect(screen.getByLabelText("صورة بعد الصيانة")).toBeTruthy();
  });

  it("تفتح صورة قبل الصيانة في Lightbox وتغلقها بالزر والنقر خارجها ولوحة المفاتيح", async () => {
    orders[0].status = "in_progress";
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1600, height: 900 }));
    vi.stubGlobal("FileReader", class MockFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = "data:image/webp;base64,cGhvdG8=";
        this.onload?.();
      }
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["photo"], { type: "image/webp" })));

    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.change(screen.getByLabelText("صورة قبل الصيانة"), {
      target: { files: [new File(["raw"], "before.jpg", { type: "image/jpeg" })] },
    });

    const preview = await screen.findByAltText("معاينة قبل الصيانة - اضغط للتكبير");
    fireEvent.click(preview);
    expect(screen.getByRole("dialog", { name: "صورة قبل الصيانة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إغلاق الصورة المكبرة" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "إغلاق الصورة المكبرة" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "صورة قبل الصيانة" })).toBeNull());

    fireEvent.keyDown(preview, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "صورة قبل الصيانة" })).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog", { name: "صورة قبل الصيانة" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "صورة قبل الصيانة" })).toBeNull());

    getContext.mockRestore();
    toBlob.mockRestore();
    vi.unstubAllGlobals();
  });

  it("تعرض أصناف المخزن وتضمّن الصنف المستخدم في تحديث أمر العمل", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    expect(screen.getByTestId("used-items-section")).toBeTruthy();
    expect(screen.getByRole("button", { name: /شمعة 10 بوصة/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /شمعة 10 بوصة/ }));
    fireEvent.click(screen.getByRole("button", { name: /حفظ وإغلاق أمر العمل/ }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      status: "completed",
      items: [{ inventoryItemId: 14, quantity: 1, source: "manual" }],
    }));
  });

  it("ترسل نتيجة العمل والمبلغ عند إغلاق الأمر", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.change(screen.getByLabelText("ما تم تنفيذه"), { target: { value: "تم تغيير الشمعات" } });
    fireEvent.change(screen.getByLabelText("المبلغ المحصل"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ وإغلاق أمر العمل/ }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 7, status: "completed", visitResult: "تم تغيير الشمعات", collectedAmount: 250, items: [] }));
  });

  it("ترسل قياسات TDS قبل وبعد كأرقام عند إغلاق الأمر", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.change(screen.getByLabelText("TDS قبل الصيانة"), { target: { value: "420" } });
    fireEvent.change(screen.getByLabelText("TDS بعد الصيانة"), { target: { value: "38" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ وإغلاق أمر العمل/ }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 7, tdsIn: 420, tdsOut: 38 }));
  });

  it("تسمح بالاختيارات السريعة للنتيجة والتحصيل", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.click(screen.getByRole("button", { name: "تمت الصيانة" }));
    fireEvent.click(screen.getByRole("button", { name: "250" }));
    expect((screen.getByLabelText("ما تم تنفيذه") as HTMLTextAreaElement).value).toBe("تمت الصيانة");
    expect((screen.getByLabelText("المبلغ المحصل") as HTMLInputElement).value).toBe("250");
  });

  it("تسمح باختيار سبب جاهز عند عدم التنفيذ", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.click(screen.getByRole("button", { name: "لم يتم التنفيذ" }));
    fireEvent.click(screen.getByRole("button", { name: "العميل طلب التأجيل" }));
    expect((screen.getByLabelText("سبب عدم التنفيذ") as HTMLTextAreaElement).value).toBe("العميل طلب التأجيل");
  });

  it("تعرض خيار التسجيل الصوتي مع إبقاء الكتابة متاحة", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    expect(screen.getByRole("button", { name: "بدء التسجيل" })).toBeTruthy();
    expect(screen.getByLabelText("ما تم تنفيذه")).toBeTruthy();
  });

  it("ترفض المبلغ السالب ولا ترسل أمر الإغلاق", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.change(screen.getByLabelText("المبلغ المحصل"), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ وإغلاق أمر العمل/ }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("ترفض المبلغ الذي يتجاوز الحد المنطقي ولا ترسل أمر الإغلاق", () => {
    orders[0].status = "in_progress";
    render(<TechnicianPreview />);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    fireEvent.change(screen.getByLabelText("المبلغ المحصل"), { target: { value: "100001" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ وإغلاق أمر العمل/ }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
