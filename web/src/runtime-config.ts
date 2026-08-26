export const DEPLOYED_API_BASE = "https://cribbage.strongcribbage.com";

export function resolveRemoteAiBase(search: string, isNativePlatform: boolean): string {
  const params = new URLSearchParams(search);
  const explicitApiBase = params.get("api");
  const apiBase = explicitApiBase ?? (isNativePlatform ? DEPLOYED_API_BASE : "");
  return apiBase.replace(/\/$/, "");
}
