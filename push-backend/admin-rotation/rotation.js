export const INTERVAL_MS = 90 * 86400000;
const STATE_KEY = "admin-rotation-v1";
const SECRET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export class RotationError extends Error {
  constructor(message = "憑證服務暫時未能使用，請稍後再試。", status = 503) { super(message); this.status = status; }
}
export function deploymentConfiguration(env) {
  if (typeof env.TARGET_WORKER !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.TARGET_WORKER)) throw new RotationError();
  let url;
  try { url = new URL(env.ADMIN_URL); } catch { throw new RotationError(); }
  if (typeof env.ADMIN_URL !== "string" || url.protocol !== "https:" || url.username || url.password ||
      url.href !== env.ADMIN_URL || url.href !== `${url.origin}/admin`) throw new RotationError();
  return Object.freeze({ targetWorker: env.TARGET_WORKER, adminUrl: url.href });
}
export function configuration(env) {
  const deployment = deploymentConfiguration(env);
  if (env.ROTATION_ENABLED !== "true" || !/^[a-f0-9]{32}$/.test(env.CF_ACCOUNT_ID || "") ||
      !/^[A-Za-z0-9_-]{20,256}$/.test(env.CF_API_TOKEN || "") ||
      !SECRET_FORMAT.test(env.INITIAL_ADMIN_TOKEN || "") || !SECRET_FORMAT.test(env.ROTATION_ENCRYPTION_KEY || "") ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(env.ACCESS_AUD || "") || !env.PUSH_BACKEND?.fetch) throw new RotationError();
  const emails = (env.TEACHER_EMAILS || "").split(",").map((value) => value.trim().toLowerCase());
  if (!emails.length || emails.length > 50 || emails.some((email) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))) throw new RotationError();
  return { ...deployment, emails: new Set(emails), audience: env.ACCESS_AUD };
}
export async function authorizeTeacher(ctx, config) {
  // Access supplies this context only after authenticating the actual invocation.
  // Never treat user-supplied Cf-Access-* headers as authenticated identity.
  if (!ctx.access || ctx.access.aud !== config.audience) throw new RotationError("請先使用獲准的老師帳戶登入。", 401);
  let identity;
  try { identity = await ctx.access.getIdentity(); } catch { throw new RotationError("登入狀態未能確認，請重新登入。", 401); }
  const email = typeof identity?.email === "string" ? identity.email.toLowerCase() : "";
  if (!config.emails.has(email)) throw new RotationError("此帳戶未獲准領取老師憑證。", 403);
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new RotationError();
  try { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0)); }
  catch { throw new RotationError(); }
}
export function newSecret() { return encode(crypto.getRandomValues(new Uint8Array(32))); }
export class RotationEngine {
  constructor(storage, env, { now = () => Date.now(), fetcher = (...args) => fetch(...args) } = {}) {
    this.storage = storage; this.env = env; this.now = now; this.fetcher = fetcher; this.tail = Promise.resolve();
  }
  run(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  async key() {
    const raw = decode(this.env.ROTATION_ENCRYPTION_KEY);
    if (raw.byteLength !== 32) throw new RotationError();
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  aad() { return new TextEncoder().encode(`bwflc.admin.rotation.v1:${this.env.CF_ACCOUNT_ID}:${deploymentConfiguration(this.env).targetWorker}`); }
  async seal(token) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: this.aad() }, await this.key(), new TextEncoder().encode(token));
    return { nonce: encode(nonce), ciphertext: encode(new Uint8Array(ciphertext)) };
  }
  async open(sealed) {
    try {
      const value = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(sealed.nonce), additionalData: this.aad() }, await this.key(), decode(sealed.ciphertext));
      const token = new TextDecoder("utf-8", { fatal: true }).decode(value);
      if (!SECRET_FORMAT.test(token) || decode(token).length !== 32) throw new Error();
      return token;
    } catch { throw new RotationError(); }
  }
  async probe(token) {
    const response = await this.env.PUSH_BACKEND.fetch("https://backend.internal/v1/admin/messages/00000000-0000-0000-0000-000000000000", {
      method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(10000)
    });
    await response.body?.cancel();
    // This read-only request is authenticated before the known missing job is queried.
    if (response.status === 404 || response.status === 200) return true;
    if (response.status === 401) return false;
    throw new RotationError();
  }
  async load() {
    let state = await this.storage.get(STATE_KEY);
    if (!state) {
      // Do not reset a working deployment to a stale bootstrap credential.
      if (!await this.probe(this.env.INITIAL_ADMIN_TOKEN)) throw new RotationError("初始憑證與推送後台不一致，請由管理員修復設定。");
      state = { version: 1, current: await this.seal(this.env.INITIAL_ADMIN_TOKEN), rotatedAt: this.now(), pending: null };
      await this.storage.put(STATE_KEY, state);
    }
    if (state.version !== 1 || !Number.isSafeInteger(state.rotatedAt) || state.rotatedAt < 0 || !state.current ||
        (state.pending !== null && (!state.pending?.sealed || !Number.isSafeInteger(state.pending.createdAt)))) throw new RotationError();
    return state;
  }
  async updateTarget(token) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/workers/scripts/${deploymentConfiguration(this.env).targetWorker}/secrets`;
    const response = await this.fetcher(url, {
      method: "PUT", headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ADMIN_TOKEN", text: token, type: "secret_text" }),
      redirect: "manual", signal: AbortSignal.timeout(10000)
    });
    // Success is determined from the live backend, not an API body that could include sensitive data.
    await response.body?.cancel();
    if (!response.ok) throw new RotationError();
  }
  async tick() {
    return this.run(async () => {
      const state = await this.load();
      if (!state.pending && this.now() < state.rotatedAt + INTERVAL_MS) return { changed: false };
      if (!state.pending) {
        state.pending = { sealed: await this.seal(newSecret()), createdAt: this.now() };
        // Persist before the network write: retries after timeouts/restarts reuse this same candidate.
        await this.storage.put(STATE_KEY, state);
      }
      const candidate = await this.open(state.pending.sealed);
      if (!await this.probe(candidate)) {
        try { await this.updateTarget(candidate); }
        catch { if (!await this.probe(candidate)) throw new RotationError(); }
      }
      if (!await this.probe(candidate)) throw new RotationError("新憑證仍在生效中，請稍後再試。");
      state.current = state.pending.sealed; state.pending = null; state.rotatedAt = this.now();
      await this.storage.put(STATE_KEY, state);
      return { changed: true };
    });
  }
  async credential() {
    return this.run(async () => {
      const state = await this.load();
      if (state.pending && await this.probe(await this.open(state.pending.sealed))) {
        // A timed-out write may already have applied. Reconcile without another remote write.
        state.current = state.pending.sealed; state.pending = null; state.rotatedAt = this.now();
        await this.storage.put(STATE_KEY, state);
      }
      const token = await this.open(state.current);
      if (!await this.probe(token)) throw new RotationError("憑證與後台不一致，請由管理員查核。");
      return { token, rotatedAt: state.rotatedAt, nextRotationAt: state.rotatedAt + INTERVAL_MS, rotationPending: Boolean(state.pending) };
    });
  }
}
