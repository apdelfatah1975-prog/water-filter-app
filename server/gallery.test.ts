import { describe, expect, it } from "vitest";
import { calculateGalleryTotals, resolveGalleryCashbox } from "./routers/gallery";

describe("gallery sales calculations", () => {
  it("calculates invoice totals from quantities and unit prices", () => {
    expect(calculateGalleryTotals([
      { quantity: 2, unitPrice: 150 },
      { quantity: 1, unitPrice: 275 },
    ])).toBe(575);
  });

  it("routes cash to an independent gallery cashbox by default", () => {
    expect(resolveGalleryCashbox(false)).toBe("gallery");
  });

  it("routes cash to the main company cashbox when merging is enabled", () => {
    expect(resolveGalleryCashbox(true)).toBe("main");
  });
});
