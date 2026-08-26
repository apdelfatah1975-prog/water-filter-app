import { describe, expect, it } from "vitest";
import { getHealthPayload } from "./health";

describe("getHealthPayload", () => {
  it("returns an independent healthy payload with uptime and ISO timestamp", () => {
    const payload = getHealthPayload();

    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("purepoint");
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
