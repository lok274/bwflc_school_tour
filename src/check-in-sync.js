import { validateStudentIdentity } from "./student-identity.js";

export const SYNC_DATABASE_NAME = "outdoorLearningDay.checkInSync.v1";
export const SYNC_ACTIVITY_ID = "bwflc-2026-11-05";
export const SYNC_UPLOAD_CUTOFF = Date.parse("2026-11-10T00:00:00+08:00");
export const SYNC_CUTOFF_LABEL = "2026年11月9日晚上11:59（香港時間）";
const stations = new Set(["departure-school", "future-school", "sun-yat-sen", "lunjiao-cake", "shawan-town", "liugeng-hall"]);
const identityKey = identity => JSON.stringify(validateStudentIdentity(identity));
const copy = value => structuredClone(value);
const stampKey = record => `${record.attractionId}|${record.checkedInAt}|${record.method}`;
const emptyState = epoch => ({ version: 1, epoch, enrollment: null, sequence: 0, pending: [], links: {}, lastUploadedAt: null });
const validId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const eventFields = ["eventId", "sequence", "checkInId", "attractionId", "checkedInAt", "eventAt", "method", "verified", "action"].sort().join("|");
const syncError = (code, message, retryable = false) => Object.assign(Error(message), { code, retryable });
const retiredEnrollment = value => Boolean(value && Object.hasOwn(value, "account"));
function validState(value) {
  if (value.version !== 1 || !validId(value.epoch) || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !Array.isArray(value.pending) || value.pending.length > 1000 || !value.links || typeof value.links !== "object") return false;
  if (!value.enrollment) return !value.pending.length && !Object.keys(value.links).length;
  try { validateStudentIdentity(value.enrollment.identity); } catch { return false; }
  if (!validId(value.enrollment.sessionId) || typeof value.enrollment.ticket !== "string" || value.enrollment.ticket.length > 4096 || !Number.isFinite(value.enrollment.expiresAt)) return false;
  return value.pending.every((event, index) => Object.keys(event).sort().join("|") === eventFields && validId(event.eventId) && validId(event.checkInId)
    && stations.has(event.attractionId) && Number.isSafeInteger(event.sequence) && event.sequence > (value.pending[index - 1]?.sequence || 0) && event.sequence <= value.sequence
    && ["gps", "manual"].includes(event.method) && event.verified === (event.method === "gps") && ["checkin", "cancel"].includes(event.action)
    && [event.checkedInAt, event.eventAt].every(date => typeof date === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date))));
}

// One read/modify/write transaction owns the epoch, sequence and queue together.
export function createSyncRepository(indexedDB, databaseName = SYNC_DATABASE_NAME) {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB?.open) { reject(Error("這部裝置未能保存待傳紀錄。")); return; }
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = request.onblocked = () => { opening = null; reject(Error("未能開啟同步儲存，請關閉其他舊版分頁後重試。")); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    return opening;
  }
  async function transact(change, discard = false) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", change ? "readwrite" : "readonly"), store = tx.objectStore("state");
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure || Error("未能保存裝置同步資料，打卡仍在這部裝置。"));
      const request = store.get("current");
      request.onsuccess = () => {
        try {
          const current = request.result;
          if (current && !discard && !validState(current)) throw Error("同步資料損壞，請清除所有裝置資料後重新啟用；Google 紀錄不會刪除。");
          result = change ? change(current ? copy(current) : null) : current || null;
          if (change) store.put(result, "current");
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  return { read: () => transact(), update: transact, reset: value => transact(() => value, true) };
}

export function isGoogleReceiverUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && !url.search && !url.hash && !url.username && !url.password
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);
  } catch { return false; }
}

export function createCheckInSync({ environment = globalThis, endpoint = "", transport, databaseName = SYNC_DATABASE_NAME,
  repository, getIdentity = () => null, canRun = () => true, onChange = () => {}, now = () => (environment.Date || Date).now(),
  uuid = () => environment.crypto.randomUUID(), requestTimeout = 10000 } = {}) {
  const configured = typeof transport === "function" || isGoogleReceiverUrl(endpoint);
  const receiverMessage = message => transport ? message.replace(/\s*Google\s*/g, "模擬接收器") : message;
  const canSave = Boolean(repository || environment.indexedDB?.open);
  const available = configured && canSave;
  const db = repository || createSyncRepository(environment.indexedDB, databaseName);
  let generation = 0, identity = null, state = null, busy = false, failure = "", needsEnable = false;
  let activeRequest = null, flushing = null, starting = null, storageFailed = false, clearing = false;
  let unsaved = [], saving = Promise.resolve();
  let uploadClosed = false, deadlineTimer = null, queue = null;
  const timerApi = environment.document ? environment.window || environment : null;
  const channel = available && environment.BroadcastChannel ? new environment.BroadcastChannel(databaseName) : null;
  if (channel) channel.onmessage = event => {
    if (event.data === "refresh") {
      const token = generation;
      void db.read().then(value => {
        if (current(token) && value?.enrollment && identityKey(value.enrollment.identity) === identity && (!state || state.epoch === value.epoch)) {
          state = value;
          if (!value.pending.length && !unsaved.length && !busy && !queue?.stopped) { cancelUpload(); failure = ""; }
          notify(); if (value.pending.length || unsaved.length) void upload(true);
        }
      }).catch(() => {});
      return;
    }
    if (event.data !== "stop") return;
    invalidate(); identity = null; state = null; unsaved = []; failure = "另一分頁已停止同步，請重新啟用。"; notify();
  };
  const online = () => environment.navigator?.onLine !== false;
  const currentIdentity = () => { try { return identityKey(getIdentity()); } catch { return null; } };
  const current = token => token === generation && identity && currentIdentity() === identity && canRun();
  const notify = () => onChange(getState());
  const closed = () => uploadClosed || now() >= SYNC_UPLOAD_CUTOFF;
  function clearDeadlineTimer() { if (deadlineTimer !== null) timerApi?.clearTimeout?.(deadlineTimer); deadlineTimer = null; }
  function armDeadlineTimer() {
    clearDeadlineTimer();
    if (!available || !canRun() || closed() || !timerApi?.setTimeout || !identity) return;
    const token = generation;
    deadlineTimer = timerApi.setTimeout(() => {
      deadlineTimer = null;
      if (current(token)) { if (closed()) cancelUpload(); notify(); armDeadlineTimer(); }
    }, Math.min(SYNC_UPLOAD_CUTOFF - now(), 2147483647));
  }
  function requireOpen() { if (closed()) throw Error("上傳已截止；裝置上的打卡、相片及已保存待傳紀錄會保留。"); }
  function getState() {
    const owned = Boolean(state?.enrollment && identity === identityKey(state.enrollment.identity));
    const enabled = owned && Boolean(state.enrollment.ticket) && !retiredEnrollment(state.enrollment);
    const pending = owned ? state.pending.length + unsaved.length : 0;
    const profileAvailable = Boolean(currentIdentity());
    const requiresEnable = needsEnable || owned && !enabled, ended = closed();
    const waiting = queue?.timer != null;
    const status = ended ? "上傳已截止" : waiting ? "排隊上傳" : busy ? "上傳中" : failure || unsaved.length ? "需要重試" : !enabled ? "尚未啟用" : pending ? "待上傳" : state.lastUploadedAt ? "已上傳" : "待上傳";
    const reason = waiting ? `${failure ? failure + " " : ""}${unsaved.length ? "待傳紀錄尚未保存在裝置，離開或重載會遺失。" : ""}${queue.failures ? "暫時未獲確認，會自動重試" : "正在排隊"}，約 ${Math.max(1, Math.ceil((queue.dueAt - now()) / 1000))} 秒後上傳；請保持網頁開啟。` : ended ? `上傳已截止；打卡、相片及已保存待傳紀錄會保留。${unsaved.length ? "未保存的待傳紀錄只暫留本次使用，離開或重載會遺失。" : ""}` : failure || (unsaved.length ? "待傳紀錄尚未保存在裝置，離開或重載會遺失；請按「立即上傳」重試。" : !profileAvailable ? "請先記住學生資料，才可保存待傳紀錄；打卡與拍照仍可使用。" : !configured ? "Google 接收服務尚未接通。" : !canSave ? "這部裝置不支援保存待傳紀錄，請使用支援的瀏覽器；本機打卡仍可使用。" : !online() ? "目前離線，連線後再上傳。" : requiresEnable ? "請重新啟用同步，待傳紀錄仍會保留。" : enabled && !pending ? "沒有待傳紀錄。" : "");
    return Object.freeze({ enabled, status: transport ? `模擬${status}` : status, pending, unsaved: unsaved.length, busy, needsEnable: requiresEnable, reason: receiverMessage(reason), closed: ended, cutoffLabel: SYNC_CUTOFF_LABEL,
      disabled: !canRun() || ended || !profileAvailable || !available || busy || waiting || clearing || !online() || enabled && !requiresEnable && !pending && !storageFailed, button: ended ? "已截止" : waiting ? "已排隊" : enabled && !requiresEnable ? "立即上傳" : "啟用同步" });
  }
  function invalidate() {
    cancelUpload(true); clearDeadlineTimer();
    generation++; activeRequest?.abort(); activeRequest = null;
    busy = false; flushing = null; starting = null; notify();
  }
  function cancelUpload(stopped = false) {
    if (queue?.timer != null) timerApi?.clearTimeout?.(queue.timer);
    queue?.resolve?.(false); queue = stopped ? { stopped: true, blocked: true } : null;
  }
  async function request(body, token) {
    const abort = new AbortController(); activeRequest = abort;
    const timers = timerApi?.setTimeout ? timerApi : globalThis;
    const timer = timers.setTimeout(() => abort.abort(), requestTimeout);
    try {
      const response = await (transport ? transport(body, abort.signal) : environment.fetch(endpoint, { method: "POST", mode: "cors", credentials: "omit", redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body), signal: abort.signal, cache: "no-store", referrerPolicy: "no-referrer" }));
      if (!current(token)) return null;
      if (!response.ok || response.type === "opaque") throw syncError("HTTP", "未取得 Google 寫入確認，紀錄仍待上傳。請重試。", response.type !== "opaque" && (response.status === 429 || response.status >= 500));
      const text = await response.text();
      if (!current(token)) return null;
      if (text.length > 32768) throw syncError("RESPONSE", "Google 回覆無法確認，紀錄仍待上傳。請重試。", true);
      let receipt;
      try { receipt = JSON.parse(text); } catch { throw syncError("RESPONSE", "Google 回覆無法確認，紀錄仍待上傳。請重試。", true); }
      if (!receipt || receipt.version !== 1 || receipt.activityId !== SYNC_ACTIVITY_ID) throw syncError("PROTOCOL", "Google 回覆不符，紀錄仍待上傳。請老師核對接收程式。");
      if (receipt.ok !== true) {
        if (receipt.error === "CLOSED") { uploadClosed = true; clearDeadlineTimer(); requireOpen(); }
        needsEnable = receipt.error === "TICKET";
        const retryable = ["BUSY", "WRITE"].includes(receipt.error);
        throw syncError(receipt.error || "PROTOCOL", needsEnable ? "上傳許可無效或已到期，請重新啟用同步；待傳紀錄仍會保留。" : body.action === "enable" ? "Google 未確認啟用，請老師核對接收程式是否已更新；打卡仍保存在這部裝置。" : retryable ? "Google 未確認寫入，紀錄仍待上傳。請重試。" : "Google 接收設定或紀錄順序未獲確認，已暫停自動重試，請老師檢查；待傳紀錄仍會保留。", retryable);
      }
      return receipt;
    } catch (error) {
      if (!current(token)) return null;
      if (typeof error.retryable === "boolean") throw error;
      throw syncError(error.name === "AbortError" ? "TIMEOUT" : "NETWORK", error.name === "AbortError" ? "上傳逾時，紀錄仍待上傳。請重試。" : "未能連接 Google，紀錄仍待上傳。請重試。", !closed());
    } finally { timers.clearTimeout(timer); if (activeRequest === abort) activeRequest = null; }
  }
  async function start(profile = getIdentity()) {
    if (clearing) return "cancelled";
    if (!available || !profile) return "unavailable";
    const key = identityKey(profile);
    if (identity === key && starting) return starting;
    if (identity !== key) invalidate();
    if (queue?.stopped) cancelUpload();
    const token = generation;
    starting = (async () => {
      try {
        const saved = await db.read();
        if (token !== generation || clearing) return "cancelled";
        if (saved?.enrollment && identityKey(saved.enrollment.identity) !== key || unsaved.some(item => item.owner !== key)) {
          failure = "學生資料與原有待傳紀錄不符，已暫停操作；原有資料會保留。";
          storageFailed = true; notify(); return "conflict";
        }
        identity = key; state = saved;
        // Retire the previous verification ticket without discarding queued events.
        if (retiredEnrollment(state?.enrollment)) {
          const epoch = state.epoch;
          state = await db.update(value => {
            if (token !== generation || clearing || value?.epoch !== epoch || !value.enrollment || identityKey(value.enrollment.identity) !== key) throw Error("另一分頁已改動同步設定，請重新開啟網站。");
            if (retiredEnrollment(value.enrollment)) {
              delete value.enrollment.account;
              value.enrollment.ticket = ""; value.enrollment.expiresAt = 0; value.lastUploadedAt = null;
            }
            return value;
          });
          channel?.postMessage("refresh");
        }
        if (token !== generation || clearing) return "cancelled";
        storageFailed = false; if (!queue?.blocked) failure = ""; notify(); armDeadlineTimer();
        if (canRun() && online()) void upload(true);
        return "ready";
      } catch (error) {
        if (token !== generation || clearing) return "cancelled";
        storageFailed = true; failure = error.message; notify(); return "failed";
      }
    })();
    const result = await starting;
    if (token === generation) starting = null;
    return result;
  }
  async function enable() {
    if (!available || !canRun() || busy || clearing || closed() || !online() || !getIdentity()) return false;
    const profile = validateStudentIdentity(getIdentity());
    if ((identity !== identityKey(profile) || storageFailed) && await start(profile) !== "ready") return false;
    if (!canRun() || storageFailed || busy || closed() || identity !== identityKey(profile) || currentIdentity() !== identity) return false;
    const token = generation;
    cancelUpload(); busy = true; failure = ""; notify();
    try {
      return await refreshPermit(token, profile);
    } catch (error) { if (current(token)) { failure = error.message; notify(); } return false; }
    finally { if (current(token)) { busy = false; notify(); if (state?.pending.length && !failure) void upload(true); } }
  }
  async function refreshPermit(token, profile) {
    requireOpen();
    const expectedEpoch = state?.epoch || null, sessionId = state?.enrollment?.sessionId || uuid();
    const receipt = await request({ version: 1, activityId: SYNC_ACTIVITY_ID, action: "enable", identity: profile, sessionId }, token);
    if (!receipt || !current(token)) return false;
    requireOpen();
    if (receipt.sessionId !== sessionId || typeof receipt.ticket !== "string" || !receipt.ticket || receipt.ticket.length > 4096
      || receipt.expiresAt !== SYNC_UPLOAD_CUTOFF) throw Error("Google 未確認固定截止許可，請老師核對接收程式是否已更新；待傳紀錄仍會保留。");
    try {
      state = await db.update(value => {
        requireOpen();
        if (!current(token) || (value?.epoch || null) !== expectedEpoch) throw Error("另一分頁已改動同步設定，請重新開啟網站。");
        const next = value || emptyState(uuid());
        next.enrollment = { identity: profile, sessionId, ticket: receipt.ticket, expiresAt: receipt.expiresAt };
        return next;
      });
    } catch (error) { throw Error(`未能保存上傳許可：${error.message} 待傳紀錄仍會保留。`); }
    if (!current(token)) return false;
    needsEnable = false; storageFailed = false; channel?.postMessage("refresh"); notify(); armDeadlineTimer(); return true;
  }
  function saveUnsaved() {
    const task = saving.catch(() => {}).then(async () => {
      while (unsaved.length && !clearing) {
        const attempt = unsaved[0], { record, action, eventId, eventAt, epoch, owner } = attempt, key = stampKey(record);
        try {
          const next = await db.update(value => {
            if (clearing || value?.epoch !== epoch || !value.enrollment || identityKey(value.enrollment.identity) !== owner) throw Error("同步設定已改動，請重新啟用同步。");
            if (action === "checkin" && value.links[key] || action === "cancel" && !value.links[key]) return value;
            if (value.pending.length >= 1000) throw Error("待傳紀錄已滿，請先上傳已保存的紀錄。");
            const checkInId = action === "checkin" ? eventId : value.links[key];
            value.pending.push({ eventId, sequence: ++value.sequence, checkInId, ...record, eventAt, action });
            if (action === "checkin") value.links[key] = checkInId; else delete value.links[key];
            return value;
          });
          if (unsaved[0] === attempt) unsaved.shift();
          if (!clearing && identity === owner && state?.epoch === epoch) state = next;
        } catch (error) { throw syncError("QUEUE_SAVE", `未能保存待傳紀錄：${error.message} 未保存的紀錄只暫留本次使用，離開或重載會遺失；請按「立即上傳」重試。`, true); }
      }
    });
    saving = task; return task;
  }
  async function prepareLogout() {
    invalidate();
    await saving.catch(() => {});
    try { await saveUnsaved(); }
    catch (error) { failure = error.message; }
    notify(); return !clearing && unsaved.length === 0;
  }
  async function enqueue(record, action = "checkin") {
    if (!available || clearing || closed() || !identity || !state?.enrollment || !current(generation)) return false;
    const token = generation, epoch = state.epoch, owner = identity;
    if (!stations.has(record.attractionId) || !["gps", "manual"].includes(record.method) || record.verified !== (record.method === "gps")
      || !["checkin", "cancel"].includes(action) || !Number.isFinite(Date.parse(record.checkedInAt))) return false;
    if (unsaved.length >= 1000) { failure = "未保存的待傳紀錄已滿，這次打卡只保存在裝置。請先重試上傳。"; notify(); return false; }
    unsaved.push({ eventId: uuid(), eventAt: new Date(now()).toISOString(), epoch, owner, action,
      record: { attractionId: record.attractionId, checkedInAt: record.checkedInAt, method: record.method, verified: record.verified } });
    try {
      await saveUnsaved();
      if (!current(token)) return false;
      if (!queue?.blocked) failure = ""; channel?.postMessage("refresh"); notify(); if (online()) void upload(true); return true;
    } catch (error) { if (current(token)) { failure = error.message; notify(); if (online()) void upload(true); } return false; }
  }
  function upload(automatic = false) {
    if (flushing) return queue?.promise || flushing;
    if (queue?.timer != null) return queue.promise;
    if (!available || clearing || busy || closed() || needsEnable || !state?.enrollment?.ticket || retiredEnrollment(state.enrollment) || !online() || !current(generation)) { notify(); return Promise.resolve(false); }
    if (automatic && queue?.blocked) return Promise.resolve(false);
    if (!automatic && queue?.blocked) cancelUpload();
    if (!queue) queue = { token: generation, failures: 0, blocked: false, timer: null, dueAt: 0, promise: null, resolve: null };
    const scheduled = queue;
    const attempt = () => {
      if (queue !== scheduled) return Promise.resolve(false);
      if (!current(scheduled.token) || !online() || closed() || clearing) { cancelUpload(); notify(); return Promise.resolve(false); }
      return performUpload(scheduled);
    };
    if (!state.pending.length && !unsaved.length) return attempt();
    if (!timerApi?.setTimeout) return attempt();
    const random = (environment.Math || Math).random();
    const delay = scheduled.failures ? 30000 + random * 30000 : 500 + random * 59500;
    scheduled.dueAt = now() + delay;
    scheduled.promise = new Promise(resolve => { scheduled.resolve = resolve; });
    scheduled.timer = timerApi.setTimeout(() => {
      scheduled.timer = null;
      const resolve = scheduled.resolve; scheduled.resolve = null;
      void attempt().then(resolve);
    }, delay);
    notify(); return scheduled.promise;
  }
  function performUpload(scheduled) {
    const token = generation, epoch = state.epoch;
    busy = true; failure = ""; notify();
    const process = async () => {
      try {
        while (current(token) && online()) {
          requireOpen();
          let latest;
          try { latest = await db.read(); } catch { throw syncError("QUEUE_READ", "未能讀取待傳紀錄，請保持網頁開啟，稍後會自動重試。", true); }
          if (!current(token)) return false;
          if (latest?.epoch !== epoch || !latest.enrollment || identityKey(latest.enrollment.identity) !== identity) {
            state = null; throw Error("另一分頁已停止同步，請重新啟用。");
          }
          state = latest;
          // Google renews legacy seven-day permits without changing the session or queue.
          if (state.enrollment.expiresAt !== SYNC_UPLOAD_CUTOFF) {
            if (!await refreshPermit(token, validateStudentIdentity(getIdentity()))) return false;
          }
          requireOpen();
          if (!state.pending.length) {
            if (!unsaved.length) { queue = null; return true; }
            await saveUnsaved();
            if (!current(token)) return false;
            continue;
          }
          const events = state.pending.slice(0, 20), sessionId = state.enrollment.sessionId;
          const receipt = await request({ version: 1, activityId: SYNC_ACTIVITY_ID, action: "submit", ticket: state.enrollment.ticket, events }, token);
          if (!receipt || !current(token)) return false;
          if (receipt.sessionId !== sessionId || !Array.isArray(receipt.accepted)
            || new Set(receipt.accepted).size !== receipt.accepted.length || !receipt.accepted.every((id, index) => id === events[index]?.eventId)) throw syncError("PROTOCOL", "Google 寫入確認不符，紀錄仍待上傳。請老師核對接收程式。");
          if (!receipt.accepted.length) throw syncError("PARTIAL", "Google 尚未確認紀錄，會自動重試。", true);
          const accepted = new Set(receipt.accepted);
          try {
            state = await db.update(value => {
              if (!current(token) || value?.epoch !== epoch || value.enrollment?.sessionId !== sessionId
                || identityKey(value.enrollment.identity) !== identity) throw Error("同步資料已清除，舊回覆不會保存。");
              value.pending = value.pending.filter(item => !accepted.has(item.eventId));
              value.lastUploadedAt = new Date(now()).toISOString(); return value;
            });
          } catch { throw syncError("ACK_SAVE", "Google 已確認寫入，但裝置未能保存確認；待傳紀錄仍保留，請重試（不會重複寫入）。", true); }
          if (!current(token)) return false;
          storageFailed = false; channel?.postMessage("refresh"); notify();
          if (receipt.accepted.length !== events.length) throw syncError("PARTIAL", "部分紀錄已上傳，其餘仍待上傳。請重試。", true);
        }
        return false;
      } catch (error) {
        if (current(token)) {
          scheduled.failures++;
          scheduled.blocked = !error.retryable || scheduled.failures >= 8;
          failure = `${error.message}${scheduled.failures >= 8 ? " 已暫停自動重試，請稍後按「立即上傳」。" : ""}`;
          notify();
        }
        return false;
      } finally {
        if (current(token)) {
          busy = false; if (flushing === work) flushing = null; notify();
          if (timerApi?.setTimeout && (queue === scheduled && !scheduled.blocked && scheduled.failures || !queue && (state?.pending.length || unsaved.length))) void upload(true);
        }
      }
    };
    // Web Locks serialize tabs where supported; receiver deduplication is still required.
    const work = environment.navigator?.locks?.request
      ? environment.navigator.locks.request(databaseName, process) : process();
    flushing = work; return work;
  }
  async function stop({ clear = false } = {}) {
    invalidate();
    if (!clear || !available) return;
    clearing = true; channel?.postMessage("stop");
    identity = null; state = null; needsEnable = false; failure = "";
    clearDeadlineTimer();
    try { const cleared = emptyState(uuid()); await (db.reset ? db.reset(cleared) : db.update(() => cleared)); unsaved = []; storageFailed = false; notify(); }
    catch (error) { storageFailed = true; failure = "未能清除裝置同步資料，請重試；Google 已保存的紀錄不會刪除。"; notify(); throw error; }
    finally { clearing = false; notify(); }
  }
  async function pendingWarning() {
    if (!available) return "";
    try {
      const value = await db.read();
      const pending = new Set([...(value?.pending || []).map(item => item.eventId), ...unsaved.map(item => item.eventId)]).size;
      return receiverMessage(pending ? `尚有 ${pending} 筆待傳紀錄，繼續會丟棄。Google 已保存的紀錄不會改動。` : "同步設定及未傳紀錄會清除；Google 已保存的紀錄不會改動。");
    } catch { return receiverMessage("未能讀取待傳紀錄；繼續會嘗試清除裝置同步資料。Google 已保存的紀錄不會改動。"); }
  }
  return Object.freeze({ start, enable, enqueue, upload, stop, invalidate, prepareLogout, pendingWarning, getState,
    networkChanged: () => { invalidate(); if (canRun() && online()) void start(); notify(); armDeadlineTimer(); } });
}
