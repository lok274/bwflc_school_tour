import webpush from "web-push";
import { endpointUrl, MESSAGE_TTL } from "./security.js";

export function encryptedRequest(subscription, message, vapid, now = Date.now()) {
  endpointUrl(subscription.endpoint);
  const remaining = Math.ceil((message.expiresAt - now) / 1000);
  if (remaining <= 0) throw new Error("expired");
  const payload = JSON.stringify({ version: 1, id: message.id, title: message.title, body: message.body, route: message.route, createdAt: message.createdAt, expiresAt: message.expiresAt });
  if (Buffer.byteLength(payload, "utf8") > 3072) throw new Error("payload_too_large");
  const details = webpush.generateRequestDetails({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
    vapidDetails: vapid, contentEncoding: "aes128gcm", TTL: Math.min(remaining, MESSAGE_TTL), urgency: "normal", topic: message.id.replaceAll("-", "").slice(0, 32)
  });
  // Workerd supports manual/follow redirect modes. Manual exposes 3xx for rejection
  // below and never sends the encrypted payload or VAPID header to a redirect target.
  return new Request(details.endpoint, { method: details.method, headers: details.headers, body: details.body ?? details.payload, redirect: "manual" });
}
export async function sendEncrypted(subscription, message, vapid, { fetchImpl = fetch, now = Date.now(), timeoutMs = 10000 } = {}) {
  const request = encryptedRequest(subscription, message, vapid, now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request, { signal: controller.signal });
    // Do not expose provider bodies, which can include subscription capabilities.
    await response.body?.cancel();
    const status = response.status;
    if (status >= 200 && status < 300) return { outcome: "accepted", status };
    if (status === 404 || status === 410) return { outcome: "gone", status };
    if (status === 429 || status >= 500) {
      const raw = response.headers.get("Retry-After");
      const date = raw ? Date.parse(raw) : NaN;
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : Number.isFinite(date) ? Math.ceil((date - now) / 1000) : 0;
      return { outcome: "retry", code: status === 429 ? "rate_limited" : "provider_unavailable", status, retryAfterMs: Math.max(0, Math.min(seconds * 1000, 3600000)) };
    }
    return { outcome: "failed", code: status === 401 || status === 403 ? "provider_auth" : "provider_rejected", status };
  } catch {
    return { outcome: "retry", code: "network_error", status: 0, retryAfterMs: 0 };
  } finally { clearTimeout(timer); }
}
