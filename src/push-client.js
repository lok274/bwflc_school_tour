import { PUSH_CONFIG } from "./push-config.js";

export const PUSH_STORAGE_KEY = "outdoorLearningDay.push.v1";
const TIMEOUT_MS = 12_000;
const RESPONSE_LIMIT = 64 * 1024;
const hexId = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validProof = value => typeof value === "string" && /^1\.[1-9]\d{0,15}\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.[a-f0-9]{64}\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(value);

// No import-time permissions, DOM writes, network requests, or journey-data access.
export function createPushClient({ environment = globalThis, config = PUSH_CONFIG, getRegistration, onChange = () => {} } = {}) {
  const notification = environment.Notification;
  const storage = environment.localStorage;
  const crypto = environment.crypto;
  const setTimer = environment.setTimeout?.bind(environment) || environment.window?.setTimeout?.bind(environment.window) || globalThis.setTimeout;
  const clearTimer = environment.clearTimeout?.bind(environment) || environment.window?.clearTimeout?.bind(environment.window) || globalThis.clearTimeout;
  const controllers = new Set();
  const receiptListeners = new Set();
  let disposed = false;
  let generation = 0;
  let operation = null;
  let registration = null;
  let remote = null;
  let subscription = null;
  let nativeCreation = null;
  let initialization = null;
  let statusMessage = "正在檢查通知設定…";
  let stored = readStorage();
  const apiBase = apiBaseUrl(config.apiBaseUrl);

  function apiBaseUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(environment.location?.hostname);
      const localApi = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(localPage && localApi && url.protocol === "http:")) return null;
      if (url.username || url.password || url.hash || url.search) return null;
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
      return url;
    } catch { return null; }
  }
  function decode(value, length) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(length * 4 / 3)) return null;
    try {
      const raw = (environment.atob || globalThis.atob)(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
      const bytes = Uint8Array.from(raw, (item) => item.charCodeAt(0));
      return bytes.length === length && encode(bytes) === value ? bytes : null;
    } catch { return null; }
  }
  function encode(bytes) {
    return (environment.btoa || globalThis.btoa)(Array.from(bytes, (item) => String.fromCharCode(item)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function validOwner(value) { return plain(value) && hexId(value.id) && Boolean(decode(value.token, 32)); }
  function readStorage() {
    try {
      const raw = storage?.getItem(PUSH_STORAGE_KEY);
      if (!raw || raw.length > RESPONSE_LIMIT) return { active: null, pending: [] };
      const value = JSON.parse(raw);
      if (!plain(value) || value.version !== 1 || !Array.isArray(value.pending) || value.pending.length > 100) return { active: null, pending: [] };
      const pending = value.pending.filter(validOwner).map(({ id, token, registrationProof }) => ({ id, token, ...(validProof(registrationProof) ? { registrationProof } : {}) }));
      const active = validOwner(value.active) && hexId(value.active.keyId) ? {
        id: value.active.id, token: value.active.token, keyId: value.active.keyId,
        registered: value.active.registered === true,
        expiresAt: Number.isSafeInteger(value.active.expiresAt) ? value.active.expiresAt : 0,
        proofVersion: value.active.proofVersion === 1 ? 1 : 0,
        ...(validProof(value.active.registrationProof) ? { registrationProof: value.active.registrationProof } : {})
      } : null;
      return { active, pending };
    } catch { return { active: null, pending: [] }; }
  }
  function persist() {
    if (!storage || typeof storage.setItem !== "function") throw new Error("storage");
    storage.setItem(PUSH_STORAGE_KEY, JSON.stringify({ version: 1, ...stored }));
  }
  function queueCleanup(owner) {
    if (!validOwner(owner)) return;
    let item = stored.pending.find((item) => item.id === owner.id && item.token === owner.token);
    if (!item) { item = { id: owner.id, token: owner.token }; stored.pending.push(item); }
    if (validProof(owner.registrationProof)) item.registrationProof = owner.registrationProof;
    if (stored.active?.id === owner.id && stored.active.token === owner.token) stored.active = null;
    persist();
  }
  function permission() { return ["default", "granted", "denied"].includes(notification?.permission) ? notification.permission : "default"; }
  function supported() {
    return environment.isSecureContext === true && Boolean(environment.navigator?.serviceWorker) && typeof notification?.requestPermission === "function"
      && Boolean(crypto?.subtle?.digest && crypto?.getRandomValues) && Boolean(environment.PushManager || registration?.pushManager);
  }
  function getSnapshot() {
    const subscribed = Boolean(subscription && permission() === "granted");
    const registered = subscribed && remote?.enabled === true && stored.active?.registered === true && stored.active.keyId === remote.keyId && stored.active.expiresAt > Date.now()
      && (!remote.registrationProofRequired || stored.active.proofVersion === 1);
    const ready = !disposed && supported() && registration?.active && remote?.enabled === true;
    return Object.freeze({
      support: supported(), permission: permission(), busy: Boolean(operation), subscribed,
      serverRegistered: Boolean(registered), statusMessage,
      canEnable: Boolean(ready && !operation && permission() !== "denied" && !registered && stored.pending.length < 100),
      canDisable: Boolean(!disposed && operation?.kind !== "disable" && (subscription || stored.active || stored.pending.length || operation?.kind === "enable")),
      canTest: Boolean(ready && !operation && registered)
    });
  }
  function changed() { if (!disposed) onChange(getSnapshot()); }
  function begin(kind) { for (const cancel of receiptListeners) cancel(); const token = ++generation; operation = { token, kind }; changed(); return token; }
  function current(token) { return !disposed && token === generation; }
  function finish(token) { if (current(token)) { operation = null; changed(); } }
  function bounded(promise, limit = TIMEOUT_MS) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimer(() => reject(new Error("timeout")), limit); })]).finally(() => clearTimer(timer));
  }
  async function hash(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function request(path, { method = "GET", body, token } = {}) {
    if (!apiBase || disposed) throw new Error("configuration");
    const Controller = environment.AbortController || globalThis.AbortController;
    const abort = new Controller();
    controllers.add(abort);
    const timer = setTimer(() => abort.abort(), TIMEOUT_MS);
    try {
      return await bounded((async () => {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await environment.fetch(new URL(path, apiBase).href, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit", redirect: "error", cache: "no-store", mode: "cors", signal: abort.signal
      });
      if (!response.ok) throw new Error(`http-${response.status}`);
      if (method === "DELETE" && response.status === 204) return null;
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("response");
      const declared = Number(response.headers.get("content-length"));
      if (declared > RESPONSE_LIMIT) throw new Error("response-size");
      let text;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new Error("response-size"); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } else {
        text = await response.text();
        if (new TextEncoder().encode(text).byteLength > RESPONSE_LIMIT) throw new Error("response-size");
      }
      const value = JSON.parse(text);
      if (!plain(value)) throw new Error("response");
      return value;
      })());
    } finally { clearTimer(timer); abort.abort(); controllers.delete(abort); }
  }
  function scopeMatches(appUrl) {
    try {
      const app = new URL(appUrl);
      const scope = registration?.scope ? new URL(registration.scope) : app;
      const page = environment.location?.href ? new URL(environment.location.href) : null;
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
        && environment.isSecureContext === true && page?.origin === app.origin && scope.origin === app.origin;
      return (app.protocol === "https:" || (app.protocol === "http:" && local)) && !app.username && !app.password && !app.search && !app.hash && app.pathname.endsWith("/")
        && app.href === scope.href && (!page || (page.origin === scope.origin && page.pathname.startsWith(scope.pathname)))
        && Boolean(registration?.scope || (page && [app.pathname, `${app.pathname}index.html`].includes(page.pathname)));
    } catch { return false; }
  }
  async function readConfiguration() {
    const value = await request("v1/config");
    if (value.enabled === false) return { enabled: false };
    const bytes = decode(value.publicKey, 65);
    if (value.enabled !== true || !bytes || bytes[0] !== 4 || !hexId(value.keyId) || !scopeMatches(value.appUrl)
      || await hash(value.publicKey) !== value.keyId) throw new Error("configuration");
    return { enabled: true, publicKey: value.publicKey, keyId: value.keyId, appUrl: value.appUrl, registrationProofRequired: value.registrationProofRequired === true };
  }
  function serializeSubscription(native) {
    const value = native.toJSON();
    if (!plain(value) || typeof value.endpoint !== "string" || value.endpoint.length > 2048 || !plain(value.keys)) throw new Error("subscription");
    const url = new URL(value.endpoint);
    const allowedHost = ["fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(url.hostname) || url.hostname.endsWith(".push.apple.com");
    const key = decode(value.keys.p256dh, 65);
    if (!allowedHost || url.protocol !== "https:" || url.port || url.username || url.password || url.hash
      || !key || key[0] !== 4 || !decode(value.keys.auth, 16)
      || (value.expirationTime !== null && value.expirationTime !== undefined && (!Number.isFinite(value.expirationTime) || value.expirationTime < 0))) throw new Error("subscription");
    return { endpoint: value.endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  }
  async function stopNative(native) {
    if (!native) return;
    const stopped = await bounded(native.unsubscribe());
    if (!stopped) {
      const actual = await bounded(registration.pushManager.getSubscription());
      if (actual && actual.endpoint === native.endpoint) throw new Error("unsubscribe");
    }
    if (subscription?.endpoint === native.endpoint) subscription = null;
  }
  async function cleanupLateNative(native, token) {
    // Providers may reuse an endpoint. An obsolete subscribe result must not
    // unsubscribe a newer explicit enable which now owns that same endpoint.
    const id = await hash(native.endpoint);
    if (generation > token && operation?.kind !== "disable" && subscription?.endpoint === native.endpoint
      && (stored.active?.id === id || operation?.kind === "enable")) return;
    const affectedCurrent = subscription?.endpoint === native.endpoint;
    await stopNative(native);
    if (affectedCurrent && stored.active?.id === id) queueCleanup(stored.active);
    if (affectedCurrent && !disposed) { statusMessage = describe(); changed(); }
  }
  async function flushCleanup(token) {
    if (!apiBase) return false;
    for (const item of [...stored.pending]) {
      if (!current(token)) return false;
      try {
        await request(`v1/subscriptions/${item.id}`, { method: "DELETE", token: item.token, ...(validProof(item.registrationProof) ? { body: { registrationProof: item.registrationProof } } : {}) });
        if (!current(token)) return false;
        stored.pending = stored.pending.filter((entry) => !(entry.id === item.id && entry.token === item.token));
        persist();
      } catch { return false; }
    }
    return stored.pending.length === 0;
  }
  async function registerNative(native, token) {
    const value = serializeSubscription(native);
    const id = await hash(value.endpoint);
    if (!current(token)) { await cleanupLateNative(native, token); return; }
    let owner = stored.active;
    if (!owner || owner.id !== id || owner.keyId !== remote.keyId) {
      if (owner) queueCleanup(owner);
      owner = { id, token: encode(crypto.getRandomValues(new Uint8Array(32))), keyId: remote.keyId, registered: false, expiresAt: 0 };
      stored.active = owner;
    }
    owner.registered = false;
    try { persist(); } // Ownership survives a lost POST response; never send before this write.
    catch (error) { await stopNative(native); throw error; }
    const workers = environment.navigator?.serviceWorker;
    const ownerHash = await hash(owner.token);
    if (!current(token)) return;
    let receive;
    const receipt = new Promise(resolve => { receive = resolve; });
    const listener = event => {
      const data = event.data;
      if (!current(token) || event.source !== registration.active || !plain(data) || data.type !== "push-registration-proof"
        || data.id !== id || data.ownerHash !== ownerHash || !validProof(data.proof) || data.proof.split(".")[4] !== remote.keyId) return;
      receive(data.proof);
    };
    const cancelReceipt = () => { workers?.removeEventListener?.("message", listener); receiptListeners.delete(cancelReceipt); receive(""); };
    workers?.addEventListener?.("message", listener);
    receiptListeners.add(cancelReceipt);
    let result;
    try {
      const body = { subscription: value, managementToken: owner.token };
      result = await request("v1/subscriptions", { method: "POST", body });
      if (current(token) && result.registered === false && result.verificationRequired === true && result.id === id && result.keyId === remote.keyId) {
        statusMessage = "正在等候裝置通知確認…"; changed();
        const proof = await bounded(receipt);
        if (!current(token)) return;
        if (!validProof(proof)) throw new Error("verification");
        owner.registrationProof = proof;
        persist(); // Cancellation must retain the receipt before confirmation can race it.
        result = await request("v1/subscriptions", { method: "POST", body: { ...body, registrationProof: proof } });
      }
    }
    catch (error) {
      if (!current(token)) { queueCleanup(owner); if (disposed) { try { await cleanupLateNative(native, token); } catch {} } else { statusMessage = "有舊訂閱的服務端刪除待連線後重試。"; changed(); } }
      throw error;
    }
    finally { cancelReceipt(); }
    if (!current(token)) { queueCleanup(owner); if (disposed) { try { await cleanupLateNative(native, token); } catch {} } else { statusMessage = "有舊訂閱的服務端刪除待連線後重試。"; changed(); } return; }
    if (result.id !== id || result.keyId !== remote.keyId || result.registered !== true || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error("response");
    owner.registered = true;
    owner.proofVersion = remote.registrationProofRequired ? 1 : 0;
    owner.expiresAt = result.expiresAt;
    persist();
  }
  async function reconcile(token) {
    const native = await bounded(registration.pushManager.getSubscription());
    if (!current(token)) return;
    subscription = native;
    if (!native) {
      if (stored.active) queueCleanup(stored.active);
      return;
    }
    const id = await hash(native.endpoint);
    if (!current(token)) return;
    const owner = stored.active;
    if (permission() !== "granted" || !owner || owner.id !== id || (remote?.enabled && owner.keyId !== remote.keyId)) {
      await stopNative(native);
      if (!current(token)) return;
      if (owner) queueCleanup(owner);
      statusMessage = owner ? "舊通知訂閱已停止；你可重新啟用。" : "舊通知訂閱缺少管理資料，已在裝置停止；服務端記錄會按保存期限清除。";
    }
  }
  function describe() {
    if (!apiBase) return config.apiBaseUrl ? "推送服務網址設定無效，沒有建立連線。" : "訊息通知暫未開放。";
    if (!supported()) return "此瀏覽器目前不能接收推送。iPhone 請先加入主畫面，再從 App 開啟。";
    if (!remote?.enabled) return "推送服務尚未啟用。";
    if (permission() === "denied") return "通知權限已關閉；請在瀏覽器或手機設定更改。";
    if (stored.pending.length) return "有舊訂閱的服務端刪除待連線後重試。";
    if (getSnapshot().serverRegistered) return "已啟用訊息推送。通知到達時間由網絡及手機系統決定。";
    if (subscription) return "裝置訂閱已建立，但服務端尚未確認；請按啟用重試。";
    return "尚未啟用通知；按啟用後才會要求權限。";
  }
  async function refresh() {
    if (disposed || operation) return getSnapshot();
    const token = begin("refresh");
    try {
      if (!apiBase) { statusMessage = describe(); return getSnapshot(); }
      registration = await bounded(Promise.resolve().then(() => getRegistration?.()));
      if (!current(token)) return getSnapshot();
      let configurationError = null;
      try { remote = await readConfiguration(); } catch (error) { remote = null; configurationError = error; }
      if (!current(token)) return getSnapshot();
      if (registration?.active && registration.pushManager) await reconcile(token);
      if (!current(token)) return getSnapshot();
      if (configurationError) throw configurationError;
      await flushCleanup(token);
      if (!current(token)) return getSnapshot();
      // A consented subscription with a lost POST response can retry idempotently.
      if (subscription && stored.active && remote?.enabled && !getSnapshot().serverRegistered) await registerNative(subscription, token);
      if (current(token)) statusMessage = describe();
    } catch { if (current(token)) statusMessage = "未能連接或核對推送服務；本機旅程資料不受影響，請稍後重試。"; }
    finally { finish(token); }
    return getSnapshot();
  }
  function initialize() { if (!initialization) initialization = refresh(); return initialization; }
  function enable() {
    if (!getSnapshot().canEnable) return Promise.resolve(getSnapshot());
    // Call before the first await, directly in the user's click handler.
    let permissionResult;
    try { permissionResult = permission() === "granted" ? Promise.resolve("granted") : notification.requestPermission(); }
    catch { statusMessage = "未能開啟通知權限要求，請再按一次。"; changed(); return Promise.resolve(getSnapshot()); }
    const token = begin("enable");
    statusMessage = "正在啟用通知…";
    changed();
    return (async () => {
      try {
        const accepted = await permissionResult;
        if (!current(token)) return getSnapshot();
        if (accepted !== "granted" || permission() !== "granted") { statusMessage = accepted === "denied" ? "通知權限未獲允許；沒有建立新訂閱。" : "你未啟用通知；沒有建立新訂閱。"; return getSnapshot(); }
        await flushCleanup(token);
        if (!current(token)) return getSnapshot();
        if (stored.pending.length) { statusMessage = "請先完成之前訂閱的服務端刪除，再重新啟用。"; return getSnapshot(); }
        let native = await bounded(registration.pushManager.getSubscription());
        if (!current(token)) return getSnapshot();
        if (native) {
          const id = await hash(native.endpoint);
          if (!current(token)) return getSnapshot();
          if (!stored.active || stored.active.id !== id || stored.active.keyId !== remote.keyId) {
            await stopNative(native);
            if (stored.active) queueCleanup(stored.active);
            await flushCleanup(token);
            if (!current(token)) return getSnapshot();
            if (stored.pending.length) throw new Error("cleanup");
            native = null;
          }
        }
        if (!native) {
          const creation = Promise.resolve(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(remote.publicKey, 65) }));
          nativeCreation = creation;
          try { native = await bounded(creation); }
          catch (error) { creation.then((lateNative) => cleanupLateNative(lateNative, token)).catch(() => {}); throw error; }
          finally { if (nativeCreation === creation) nativeCreation = null; }
          if (!current(token)) { await cleanupLateNative(native, token); return getSnapshot(); }
        }
        subscription = native;
        await registerNative(native, token);
        if (current(token)) statusMessage = describe();
      } catch {
        if (current(token)) {
          // If ownership cannot be persisted, no POST was sent: stop the unmanaged native subscription.
          if (subscription && !stored.active) { try { await stopNative(subscription); } catch {} }
          statusMessage = "未能完成啟用；不代表已開始收到通知，請檢查連線及儲存設定後重試。";
        }
      } finally { finish(token); }
      return getSnapshot();
    })();
  }
  async function disable() {
    if (disposed || operation?.kind === "disable") return getSnapshot();
    const token = begin("disable");
    statusMessage = "正在停止裝置通知…";
    changed();
    let stopped = false;
    try {
      if (!registration) registration = await bounded(Promise.resolve().then(() => getRegistration?.()));
      if (!current(token)) return getSnapshot();
      if (!registration?.pushManager && (stored.active || subscription)) throw new Error("registration");
      // Stop native delivery first; do not depend on backend connectivity.
      const native = subscription || await bounded(registration?.pushManager?.getSubscription());
      if (native) await stopNative(native);
      const pendingNative = nativeCreation;
      if (pendingNative) { const lateNative = await bounded(pendingNative.catch(() => null)); if (lateNative) await stopNative(lateNative); }
      if (!current(token)) return getSnapshot();
      subscription = null;
      stopped = true;
      if (stored.active) queueCleanup(stored.active);
      await flushCleanup(token);
      if (current(token)) statusMessage = stored.pending.length ? "裝置通知已停止；服務端刪除待連線後重試。" : "已停止通知；手機或瀏覽器的通知權限設定會保留。";
    } catch { if (current(token)) statusMessage = stopped ? "裝置通知已停止，但未能保存或完成服務端刪除；請保持此頁並重試。" : "未能確認裝置通知已停止，請在手機或瀏覽器設定關閉權限，再重試。"; }
    finally { finish(token); }
    return getSnapshot();
  }
  async function sendTest() {
    if (!getSnapshot().canTest) return getSnapshot();
    const token = begin("test");
    try {
      await request(`v1/subscriptions/${stored.active.id}/test`, { method: "POST", token: stored.active.token });
      if (current(token)) statusMessage = "已安排測試通知，請查看裝置通知；不保證即時到達。";
    } catch { if (current(token)) statusMessage = "未能安排測試通知，請檢查連線後重試。"; }
    finally { finish(token); }
    return getSnapshot();
  }
  function dispose() {
    disposed = true;
    generation += 1;
    operation = null;
    for (const cancel of receiptListeners) cancel();
    for (const abort of controllers) abort.abort();
    controllers.clear();
  }
  return { getSnapshot, initialize, refresh, enable, disable, sendTest, dispose };
}
