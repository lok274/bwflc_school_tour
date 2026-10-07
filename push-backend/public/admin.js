const ROUTES = Object.freeze({
  home: "首頁",
  itinerary: "行程",
  attractions: "景點",
  prepare: "出發準備",
  "attraction/future-school": "東莞松山湖未來學校",
  "attraction/sun-yat-sen": "孫中山故居紀念館",
  "attraction/lunjiao-cake": "歡姐倫教糕博物館",
  "attraction/shawan-town": "沙灣古鎮",
  "attraction/liugeng-hall": "留耕堂"
});
const JOB_STATES = new Set(["queued", "sending", "complete", "partial", "failed", "expired"]);
const COUNTS = ["total", "accepted", "pending", "failed", "expired"];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function validateDraft({ title, body, route }) {
  if (typeof title !== "string" || typeof body !== "string" || typeof route !== "string") {
    throw new Error("請填寫完整的公告內容。");
  }
  title = title.trim();
  body = body.trim();
  if (!title || Array.from(title).length > 80 || /[\u0000-\u001f\u007f]/u.test(title)) {
    throw new Error("標題需要 1 至 80 字，並保持在同一行。");
  }
  if (!body || Array.from(body).length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) {
    throw new Error("內容需要 1 至 600 字。");
  }
  if (!Object.hasOwn(ROUTES, route)) throw new Error("請選擇 App 內的頁面。");
  return Object.freeze({ title, body, route });
}

export function validateJob(value) {
  if (!value || typeof value !== "object" || typeof value.jobId !== "string" ||
      typeof value.messageId !== "string" || !ID_PATTERN.test(value.jobId) ||
      !ID_PATTERN.test(value.messageId) || !JOB_STATES.has(value.status)) {
    throw new Error("未能確認伺服器回覆，請重新查核。");
  }
  const job = { jobId: value.jobId, messageId: value.messageId, status: value.status };
  for (const name of [...COUNTS, "createdAt", "updatedAt"]) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 0) {
      throw new Error("未能確認伺服器回覆，請重新查核。");
    }
    job[name] = value[name];
  }
  if (job.accepted + job.pending + job.failed + job.expired !== job.total) {
    throw new Error("未能確認伺服器回覆，請重新查核。");
  }
  return Object.freeze(job);
}

function makeId(crypto) {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") throw new Error("此瀏覽器未能安全建立發送紀錄，請使用新版瀏覽器。");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAdminController({
  document,
  environment = globalThis,
  fetch = environment.fetch?.bind(environment),
  timeoutMs = 15000,
  maxPolls = 10
} = {}) {
  if (!document || typeof fetch !== "function") throw new Error("公告介面未能啟動。");
  const ids = [
    "session-form", "admin-token", "use-token", "clear-session", "session-status",
    "draft-form", "message-title", "message-body", "message-route", "preview-message",
    "preview-section", "preview-title", "preview-body", "preview-route", "confirm-public", "send-message",
    "operation-status", "job-counts", "refresh-status", "retry-failed", "new-draft",
    ...COUNTS.map(name => `count-${name}`)
  ];
  const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  if (Object.values(elements).some(element => !element)) throw new Error("公告介面缺少必要控制項。");
  let credential = "";
  let preview = null;
  let attempt = null;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let pollTimer = null;
  let pollCount = 0;
  let requestController = null;
  let message = "先預覽並確認內容，再發送公告。";
  const listeners = [];

  function on(id, type, callback) {
    elements[id].addEventListener(type, callback);
    listeners.push(() => elements[id].removeEventListener(type, callback));
  }

  function stopPoll() {
    if (pollTimer !== null) environment.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function render() {
    elements["session-status"].textContent = credential
      ? "憑證已暫存於此頁；伺服器會在發送或查核時驗證。"
      : "尚未輸入憑證。";
    elements["operation-status"].textContent = message;
    elements["admin-token"].disabled = busy || disposed;
    elements["use-token"].disabled = busy || disposed;
    elements["clear-session"].disabled = !credential && !busy;
    for (const id of ["message-title", "message-body", "message-route", "preview-message"]) {
      elements[id].disabled = busy || Boolean(attempt) || disposed;
    }
    elements["preview-section"].hidden = !preview;
    elements["preview-title"].textContent = preview?.title ?? "";
    elements["preview-body"].textContent = preview?.body ?? "";
    elements["preview-route"].textContent = preview ? ROUTES[preview.route] : "";
    elements["confirm-public"].disabled = busy || Boolean(attempt) || disposed;
    elements["send-message"].disabled = !credential || !preview || !elements["confirm-public"].checked || busy || Boolean(attempt) || disposed;
    elements["refresh-status"].disabled = !credential || !attempt || busy || disposed;
    elements["retry-failed"].disabled = !credential || busy || disposed || !attempt?.job ||
      !["partial", "failed"].includes(attempt.job.status) || !attempt.job.failed;
    elements["new-draft"].disabled = !attempt || busy || disposed;
    elements["job-counts"].hidden = !attempt?.job;
    for (const name of COUNTS) elements[`count-${name}`].textContent = String(attempt?.job?.[name] ?? 0);
  }

  function draftFromInputs() {
    return validateDraft({ title: elements["message-title"].value, body: elements["message-body"].value, route: elements["message-route"].value });
  }

  function preparePreview(event) {
    event?.preventDefault();
    if (busy || attempt || disposed) return;
    try {
      preview = draftFromInputs();
      elements["confirm-public"].checked = false;
      message = "請確認預覽內容可以公開，再勾選確認及發送。";
    } catch (error) {
      preview = null;
      message = error.message;
    }
    render();
  }

  function editDraft() {
    if (attempt || busy || disposed) return;
    preview = null;
    elements["confirm-public"].checked = false;
    message = "內容已修改，請重新預覽及確認。";
    render();
  }

  function useCredential(event) {
    event?.preventDefault();
    if (busy || disposed) return;
    const candidate = elements["admin-token"].value.trim();
    elements["admin-token"].value = "";
    if (!candidate || candidate.length > 512 || /\s|[\u0000-\u001f\u007f]/u.test(candidate)) {
      message = "請輸入管理員提供的完整憑證。";
      render();
      return;
    }
    credential = candidate;
    message = attempt ? "憑證已暫存。請按「重新查核」查看這次發送。" : "憑證已暫存。請預覽並確認公告內容。";
    render();
  }

  function clearSession() {
    if (disposed) return;
    generation += 1;
    stopPoll();
    requestController?.abort();
    requestController = null;
    credential = "";
    elements["admin-token"].value = "";
    busy = false;
    message = attempt
      ? "已清除憑證。已提交的公告可能仍在處理；重新輸入憑證後可查核，清除憑證不會取消發送。"
      : "已清除憑證。";
    render();
  }

  async function request(path, { method = "GET", body, idempotencyKey } = {}) {
    const controller = new environment.AbortController();
    requestController = controller;
    const timer = environment.setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Authorization: `Bearer ${credential}`, Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    try {
      const response = await fetch(path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        credentials: "omit", mode: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(response.status === 401
          ? "憑證無效或已失效。請重新輸入憑證，再查核這次發送。"
          : "未能確認伺服器回覆，請稍後重新查核。");
        error.unauthorized = response.status === 401;
        throw error;
      }
      const text = await response.text();
      if (text.length > 32768) throw new Error("未能確認伺服器回覆，請重新查核。");
      return validateJob(JSON.parse(text));
    } finally {
      environment.clearTimeout(timer);
      if (requestController === controller) requestController = null;
    }
  }

  function describeJob(job) {
    if (job.status === "queued" || job.status === "sending") return "公告已排程，正在處理推送。";
    if (!job.total) return "公告已公開，這次沒有可用的訂閱裝置。";
    if (job.status === "complete") return "公告已公開，推送服務已接受本次推送。";
    if (job.status === "expired") return "本次推送已過期。公告仍可在 App 閱讀。";
    if (job.status === "partial") return "公告已公開，部分推送未成功或訂閱已失效。";
    return "公告已公開，推送未成功。可重試未成功的推送。";
  }

  function schedulePoll() {
    stopPoll();
    if (disposed || !credential || !attempt?.job || !["queued", "sending"].includes(attempt.job.status)) return;
    if (pollCount >= maxPolls) {
      message = "已暫停自動更新。公告仍在後台處理，可按「重新查核」查看最新結果。";
      render();
      return;
    }
    const delay = Math.min(2000 * 2 ** Math.min(pollCount, 4), 30000);
    pollTimer = environment.setTimeout(() => {
      pollTimer = null;
      pollCount += 1;
      void perform("refresh", false);
    }, delay);
  }

  async function perform(action, manual = true) {
    if (!credential || !attempt || busy || disposed) return;
    if (action === "retry" && (!attempt.job || !["partial", "failed"].includes(attempt.job.status) || !attempt.job.failed)) return;
    const thisAttempt = attempt;
    const token = generation;
    stopPoll();
    if (manual) pollCount = 0;
    busy = true;
    message = action === "retry" ? "正在重試未成功的推送……" : "正在查核本次發送……";
    render();
    try {
      const job = action === "retry"
        ? await request(`/v1/admin/messages/${thisAttempt.job.jobId}/retry`, { method: "POST" })
        : thisAttempt.job
          ? await request(`/v1/admin/messages/${thisAttempt.job.jobId}`)
          : await request("/v1/admin/messages", { method: "POST", body: thisAttempt.body, idempotencyKey: thisAttempt.key });
      if (disposed || token !== generation || attempt !== thisAttempt) return;
      if (thisAttempt.job && (job.jobId !== thisAttempt.job.jobId || job.messageId !== thisAttempt.job.messageId)) {
        throw new Error("未能確認這次發送的回覆，請重新查核。");
      }
      thisAttempt.job = job;
      thisAttempt.uncertain = false;
      message = describeJob(job);
    } catch (error) {
      if (disposed || token !== generation || attempt !== thisAttempt) return;
      if (error.unauthorized) credential = "";
      thisAttempt.uncertain = !thisAttempt.job;
      message = error.unauthorized ? error.message : thisAttempt.job
        ? "暫時未能更新進度；顯示的是上次記錄。可按「重新查核」再試。"
        : "未能確認發送結果，公告可能已排程。請按「重新查核」沿用這次發送，避免重複公告。";
      return;
    } finally {
      if (!disposed && token === generation && attempt === thisAttempt) {
        busy = false;
        render();
      }
    }
    schedulePoll();
  }

  function send() {
    if (!credential || !preview || !elements["confirm-public"].checked || busy || attempt || disposed) return;
    try {
      const current = draftFromInputs();
      if (JSON.stringify(current) !== JSON.stringify(preview)) {
        editDraft();
        return;
      }
      attempt = { key: makeId(environment.crypto), body: preview, job: null, uncertain: true };
      generation += 1;
      void perform("refresh");
    } catch (error) {
      message = error.message;
      render();
    }
  }

  function newDraft() {
    if (!attempt || busy || disposed) return;
    if ((attempt.uncertain || attempt.job?.pending) && !environment.confirm?.(
      "上一則公告可能已排程，建立新公告不會取消它。確定另建一則公告？"
    )) return;
    generation += 1;
    stopPoll();
    attempt = null;
    preview = null;
    elements["confirm-public"].checked = false;
    message = "正在編寫另一則公告。請重新預覽及確認。";
    render();
    elements["message-title"].focus();
  }

  on("session-form", "submit", useCredential);
  on("clear-session", "click", clearSession);
  on("draft-form", "submit", preparePreview);
  for (const id of ["message-title", "message-body"]) on(id, "input", editDraft);
  on("message-route", "change", editDraft);
  on("confirm-public", "change", render);
  on("send-message", "click", send);
  on("refresh-status", "click", () => { void perform("refresh"); });
  on("retry-failed", "click", () => { void perform("retry"); });
  on("new-draft", "click", newDraft);
  render();
  return Object.freeze({
    clearSession,
    getSnapshot: () => Object.freeze({
      hasCredential: Boolean(credential), busy, hasPreview: Boolean(preview),
      hasAttempt: Boolean(attempt), uncertain: Boolean(attempt?.uncertain), job: attempt?.job ?? null
    }),
    dispose() {
      if (disposed) return;
      clearSession();
      disposed = true;
      for (const remove of listeners) remove();
      render();
    }
  });
}

if (typeof document !== "undefined" && document.getElementById("session-form")) {
  const controller = createAdminController({ document });
  globalThis.addEventListener("pagehide", () => controller.clearSession());
}
