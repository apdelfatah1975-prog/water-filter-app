import { randomBytes } from "node:crypto";

const DEVELOPMENT_JWT_SECRET = randomBytes(32).toString("base64url");

/**
 * Returns the configured signing secret. Production must provide a strong
 * environment secret; non-production gets a per-process random secret so no
 * credential is embedded in the source tree.
 */
export function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= JWT_SECRET_MIN_LENGTH) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`JWT_SECRET must be configured with at least ${JWT_SECRET_MIN_LENGTH} characters in production`);
  }
  return DEVELOPMENT_JWT_SECRET;
}

export function getJwtSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

export const JWT_SECRET_MIN_LENGTH = 32;
