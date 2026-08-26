export function getHealthPayload() {
  return {
    status: "ok" as const,
    service: "purepoint" as const,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
