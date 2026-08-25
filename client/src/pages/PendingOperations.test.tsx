import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PendingOperations from "./PendingOperations";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin", name: "مدير الاختبار" } }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}));

describe("بطاقات حالة الاتصال والمزامنة", () => {
  afterEach(() => cleanup());

  it("تفتح إعدادات الاتصال والمزامنة عند النقر على البطاقتين", () => {
    render(<PendingOperations />);

    expect(screen.getByTestId("connection-settings-card").getAttribute("href")).toBe("/settings?section=sync");
    expect(screen.getByTestId("sync-settings-card").getAttribute("href")).toBe("/settings?section=sync");
    expect(screen.getByRole("link", { name: "فتح إعدادات الاتصال والمصدر المركزي" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "فتح إعدادات المزامنة والتحديث التلقائي" })).toBeTruthy();
  });
});

export {};
