import { afterEach, describe, expect, it } from "vitest";
import { getJwtSecret, getJwtSecretKey, JWT_SECRET_MIN_LENGTH } from "./_core/jwtSecret";

const originalSecret = process.env.JWT_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("JWT_SECRET configuration", () => {
  it("uses a configured secret when it meets the minimum length", () => {
    process.env.JWT_SECRET = "a".repeat(JWT_SECRET_MIN_LENGTH);
    expect(getJwtSecret()).toHaveLength(JWT_SECRET_MIN_LENGTH);
    expect(getJwtSecretKey()).toHaveLength(JWT_SECRET_MIN_LENGTH);
  });

  it("uses a per-process random secret outside production when the environment value is short", () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "too-short-secret";
    expect(getJwtSecret().length).toBeGreaterThanOrEqual(JWT_SECRET_MIN_LENGTH);
    expect(getJwtSecretKey().length).toBeGreaterThanOrEqual(JWT_SECRET_MIN_LENGTH);
  });

  it("rejects a missing or short secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "too-short-secret";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET must be configured/);
  });
});
