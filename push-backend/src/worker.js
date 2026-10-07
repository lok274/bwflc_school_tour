import { DurableObject } from "cloudflare:workers";
import { ApiError, abuseIdentifier, bearer, idempotencyKey, readJson, requireAdmin, requireConfigured, settings, sha256, validateMessage, validateSubscription } from "./security.js";
import { PushRepository } from "./repository.js";
import { sendEncrypted } from "./transport.js";

const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";
function json(body, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } }); }
function errorResponse(error) {
  return json({ error: { code: error instanceof ApiError ? error.code : "internal_error", message: error instanceof ApiError ? error.message.trim() : "推送服務暫時未能處理要求。" } }, error instanceof ApiError ? error.status : 500);
}
function validId(id) { if (!/^[a-f0-9]{64}$/.test(id || "")) throw new ApiError(400, "invalid_request", "訂閱識別碼不正確。"); return id; }
function validJob(id) { if (!/^[0-9a-f-]{36}$/.test(id || "")) throw new ApiError(400, "invalid_request", "工作識別碼不正確。"); return id; }

export class PushService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.repository = new PushRepository(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.repository.initialize());
  }
  async schedule() { await this.ctx.storage.setAlarm(this.repository.nextAlarm(Date.now())); }
  async fetch(request) {
    try {
      const url = new URL(request.url); const now = Date.now();
      this.repository.cleanup(now);
      const config = settings(this.env); requireConfigured(config);
      const keyId = await sha256(config.vapid.publicKey);
      if (url.pathname === "/v1/messages" && request.method === "GET") return json({ messages: this.repository.messages(now) });
      if (url.pathname === "/v1/subscriptions" && request.method === "POST") {
        const ipHash = abuseIdentifier(request.headers.get("CF-Connecting-IP") || "unknown", this.env.ADMIN_TOKEN);
        this.repository.rate(`register-minute:${ipHash}`, 120, 60000, now);
        this.repository.rate(`register-day:${ipHash}`, 1000, 86400000, now);
        const body = await readJson(request);
        const subscription = await validateSubscription(body, now);
        const registered = this.repository.register(subscription, keyId, now);
        await this.schedule(); return json(registered, 201);
      }
      const owner = /^\/v1\/subscriptions\/([^/]+)(\/test)?$/.exec(url.pathname);
      if (owner) {
        const ipHash = abuseIdentifier(request.headers.get("CF-Connecting-IP") || "unknown", this.env.ADMIN_TOKEN);
        this.repository.rate(`owner-minute:${ipHash}`, 120, 60000, now);
        this.repository.rate(`owner-day:${ipHash}`, 1000, 86400000, now);
        const id = validId(owner[1]); const token = bearer(request);
        if (!token) throw new ApiError(401, "unauthorized", "缺少訂閱管理憑證。");
        const hash = await sha256(token);
        this.repository.authorizeOwner(id, hash);
        if (!owner[2] && request.method === "DELETE") {
          this.repository.remove(id, hash, now); await this.schedule();
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        if (owner[2] && request.method === "POST") {
          const sub = this.repository.authorizeOwner(id, hash);
          if (!sub || sub.expiresAt <= now) throw new ApiError(404, "not_found", "這個裝置未有有效訂閱。");
          this.repository.rate(`test:${id}`, 3, 300000, now);
          const message = { title: "通知測試", body: "這是旅程助手的測試通知。", route: "home" };
          const key = `test:${id}:${crypto.randomUUID()}`;
          const status = this.repository.createMessage(message, key, await sha256(JSON.stringify(message)), now, id);
          await this.schedule(); return json(status, 202);
        }
      }
      if (url.pathname.startsWith("/v1/admin/")) {
        requireAdmin(request, this.env);
        if (url.pathname === "/v1/admin/messages" && request.method === "POST") {
          const key = idempotencyKey(request); const message = validateMessage(await readJson(request));
          const hash = await sha256(JSON.stringify(message));
          // A retry with the same key does not consume a new broadcast quota.
          const existing = this.repository.one("SELECT payloadHash FROM messages WHERE idempotencyKey = ?", key);
          if (!existing) this.repository.rate("admin-send", 30, 3600000, now);
          const status = this.repository.createMessage(message, key, hash, now);
          await this.schedule(); return json(status, 202);
        }
        const match = /^\/v1\/admin\/messages\/([^/]+)(\/retry)?$/.exec(url.pathname);
        if (match) {
          const id = validJob(match[1]);
          if (request.method === "GET" && !match[2]) return json(this.repository.status(id));
          if (request.method === "POST" && match[2]) {
            this.repository.rate("admin-retry", 30, 3600000, now);
            const status = this.repository.retry(id, now); await this.schedule(); return json(status, 202);
          }
        }
      }
      throw new ApiError(404, "not_found", "找不到這個功能。");
    } catch (error) { return errorResponse(error); }
  }
  async alarm() {
    this.repository.cleanup(Date.now());
    const config = settings(this.env);
    if (!config.enabled) { await this.ctx.storage.setAlarm(this.repository.nextAlarm(Date.now(), false)); return; }
    const deliveries = this.repository.claim(Date.now());
    // Small fixed batches bound provider requests and work per invocation.
    await Promise.all(deliveries.map(async (delivery) => {
      let result;
      try { result = await sendEncrypted(delivery.subscription, delivery.message, config.vapid); }
      catch (error) {
        const name = ["TypeError", "NotSupportedError", "Error"].includes(error?.name) ? error.name : "Error";
        const code = typeof error?.code === "string" && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : "";
        result = { outcome: "failed", code: `invalid_subscription:${name}:${code}` };
      }
      this.repository.finish(delivery, result, Date.now());
    }));
    await this.schedule();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url); const config = settings(env);
    const origin = request.headers.get("Origin");
    const admin = url.pathname.startsWith("/v1/admin/");
    const allowed = origin && (origin === url.origin || (!admin && config.origins.has(origin)));
    let response;
    try {
      if (origin && !allowed) throw new ApiError(403, "origin_denied", "這個網站不能使用推送服務。");
      if (url.search) throw new ApiError(400, "invalid_request", "要求網址不正確。");
      if (request.method === "OPTIONS") {
        const method = request.headers.get("Access-Control-Request-Method");
        const requested = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((h) => h.trim()).filter(Boolean);
        if (!allowed || !["GET", "POST", "DELETE"].includes(method) || requested.some((header) => !["content-type", "authorization", "idempotency-key"].includes(header))) throw new ApiError(403, "origin_denied", "跨來源要求不受支援。");
        response = new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key", "Access-Control-Max-Age": "300", "Cache-Control": "no-store" } });
      } else if (url.pathname === "/v1/config" && request.method === "GET") {
        response = json({ enabled: config.enabled, publicKey: config.enabled ? config.vapid.publicKey : "", keyId: config.enabled ? await sha256(config.vapid.publicKey) : "", appUrl: config.appUrl });
      } else if (url.pathname === "/admin/" && ["GET", "HEAD"].includes(request.method)) {
        response = new Response(null, { status: 307, headers: { Location: "/admin", "Cache-Control": "no-store" } });
      } else if (["/", "/admin", "/admin.html", "/admin.js", "/admin.css"].includes(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
        const asset = new URL(request.url); if (["/", "/admin"].includes(asset.pathname)) asset.pathname = "/admin.html";
        const served = env.ASSETS ? await env.ASSETS.fetch(new Request(asset, request)) : new Response("管理頁尚未設定。", { status: 503 });
        response = new Response(served.body, served);
        response.headers.set("Content-Security-Policy", ADMIN_CSP);
        response.headers.set("Referrer-Policy", "no-referrer");
        response.headers.set("X-Content-Type-Options", "nosniff");
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
      } else if (/^\/v1\/(?:subscriptions(?:\/[a-f0-9]{64}(?:\/test)?)?|messages|admin\/messages(?:\/[0-9a-f-]{36}(?:\/retry)?)?)$/.test(url.pathname)) {
        requireConfigured(config);
        const id = env.PUSH_SERVICE.idFromName("announcements-v1");
        response = await env.PUSH_SERVICE.get(id).fetch(request);
      } else throw new ApiError(404, "not_found", "找不到這個功能。");
    } catch (error) { response = errorResponse(error); }
    response = new Response(response.body, response);
    response.headers.set("Vary", "Origin");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (allowed && !admin) response.headers.set("Access-Control-Allow-Origin", origin);
    return response;
  }
};
