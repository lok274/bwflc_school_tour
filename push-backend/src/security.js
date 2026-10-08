import { createECDH, createHmac, timingSafeEqual } from "node:crypto";

export const ROUTES = new Set(["home", "itinerary", "attractions", "attraction/future-school", "attraction/sun-yat-sen", "attraction/lunjiao-cake", "attraction/shawan-town", "attraction/liugeng-hall"]);
export const BODY_LIMIT = 8192;
export const SUBSCRIPTION_DAYS = 30;
export const MESSAGE_TTL = 86400;

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function invalid(message = "資料格式不正確。") { throw new ApiError(400, "invalid_request", message); }

export function base64url(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) invalid();
  return decoded;
}
export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function abuseIdentifier(value, secret) { return createHmac("sha256", secret).update(value).digest("hex"); }
export function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1] || "";
}
export function exactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) invalid();
}
export function endpointUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || !value.length) invalid("推送訂閱網址不正確。 ");
  let url; try { url = new URL(value); } catch { invalid("推送訂閱網址不正確。 "); }
  const hostAllowed = url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" || url.hostname.endsWith(".push.apple.com");
  // The remaining path/query is an opaque provider capability. Never follow redirects.
  if (!hostAllowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.href !== value || url.pathname === "/") invalid("這個推送服務不受支援。 ");
  return url;
}
export async function validateSubscription(body, now = Date.now()) {
  exactKeys(body, ["subscription", "managementToken"]);
  base64url(body.managementToken, 32);
  const sub = body.subscription;
  exactKeys(sub, ["endpoint", "keys", "expirationTime"], ["endpoint", "keys"]);
  endpointUrl(sub.endpoint);
  exactKeys(sub.keys, ["p256dh", "auth"]);
  const publicKey = base64url(sub.keys.p256dh, 65);
  base64url(sub.keys.auth, 16);
  if (publicKey[0] !== 4) invalid();
  try { await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []); } catch { invalid("推送加密公鑰不正確。 "); }
  const expiry = sub.expirationTime;
  if (expiry != null && (!Number.isSafeInteger(expiry) || expiry <= now)) invalid("推送訂閱已過期。 ");
  return {
    id: await sha256(sub.endpoint), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    ownerHash: await sha256(body.managementToken), expiresAt: Math.min(now + SUBSCRIPTION_DAYS * 86400000, expiry ?? Infinity)
  };
}
export function validateMessage(body) {
  exactKeys(body, ["title", "body", "route"], ["title", "body"]);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const route = body.route ?? "home";
  const malformedUnicode = Array.from(title + text).some((character) => character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff);
  if (!title || !text || malformedUnicode || Array.from(title).length > 80 || Array.from(text).length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title + text) || !ROUTES.has(route)) invalid("請輸入標題（最多 80 字）、內容（最多 600 字）及有效頁面。 ");
  return { title, body: text, route };
}
export function idempotencyKey(request) {
  const key = request.headers.get("Idempotency-Key") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) invalid("缺少有效的訊息識別碼。 ");
  return key.toLowerCase();
}
function loopback(url) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
export function settings(env) {
  let app;
  try {
    app = new URL(env.APP_URL);
    if (app.origin !== env.APP_ORIGIN || app.hash || app.search || app.username || app.password || !app.pathname.endsWith("/") || (app.protocol !== "https:" && !(env.ENVIRONMENT === "local" && app.protocol === "http:" && loopback(app)))) throw new Error();
    const publicBytes = base64url(env.VAPID_PUBLIC_KEY, 65);
    const privateBytes = base64url(env.VAPID_PRIVATE_KEY, 32);
    base64url(env.ADMIN_TOKEN, 32);
    const ecdh = createECDH("prime256v1"); ecdh.setPrivateKey(privateBytes);
    if (publicBytes[0] !== 4 || !timingSafeEqual(ecdh.getPublicKey(), publicBytes)) throw new Error();
    const subject = new URL(env.VAPID_SUBJECT);
    if (!(["https:", "mailto:"].includes(subject.protocol)) || subject.username || subject.password || (subject.protocol === "https:" && loopback(subject))) throw new Error();
    const origins = new Set([app.origin]);
    if (env.ENVIRONMENT === "local" && env.LOCAL_DEV_ORIGINS) {
      for (const value of env.LOCAL_DEV_ORIGINS.split(",")) {
        const url = new URL(value.trim());
        if (url.origin !== value.trim() || !loopback(url) || !["http:", "https:"].includes(url.protocol)) throw new Error();
        origins.add(url.origin);
      }
    }
    return { enabled: true, appUrl: app.href, origins, vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } };
  } catch {
    return { enabled: false, appUrl: typeof env.APP_URL === "string" ? env.APP_URL : "", origins: new Set([env.APP_ORIGIN].filter(Boolean)) };
  }
}
export async function readJson(request, timeoutMs = 10000) {
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "unsupported_media_type", "請使用 JSON 資料。 ");
  const stated = request.headers.get("Content-Length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) > BODY_LIMIT)) throw new ApiError(413, "too_large", "資料過大。 ");
  const reader = request.body?.getReader();
  if (!reader) invalid();
  let size = 0; const chunks = [];
  let timer;
  const read = async () => {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > BODY_LIMIT) { void reader.cancel().catch(() => {}); throw new ApiError(413, "too_large", "資料過大。 "); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new ApiError(408, "request_timeout", "讀取資料逾時。 ")); }, timeoutMs);
  });
  try { return await Promise.race([read(), deadline]); }
  catch (error) { if (error instanceof ApiError) throw error; invalid(); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
export function requireConfigured(config) { if (!config.enabled) throw new ApiError(503, "not_configured", "推送服務尚未設定。 "); }
export function requireAdmin(request, env) { if (!equalSecret(bearer(request), env.ADMIN_TOKEN)) throw new ApiError(401, "unauthorized", "管理憑證不正確。 "); }
