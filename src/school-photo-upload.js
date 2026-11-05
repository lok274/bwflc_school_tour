import { readonlyCopy } from "./store.js";

export const PHOTO_UPLOAD_ENDPOINT = "https://script.google.com/macros/s/AKfycbyAxiBEgnO4CA3r-9fc5OuXLXgoSmRq0lcrlsmw4HPhD3jWuTefanXBGoJmWt5H60ZY/exec";
export const PHOTO_UPLOAD_DEADLINE = Date.parse("2026-11-09T23:59:00+08:00");
const CHUNK_BYTES = 4 * 1024 * 1024;
const PREFIX_BYTES = 65536;
const uncertain = "未能確認儲存。請保留此頁，重新輸入同一上傳碼後按重試，先核對進度。";
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function createSchoolPhotoUpload({ environment = globalThis, enabled = true, isCurrent = () => true,
  onChange = () => {}, transport } = {}) {
  const { document, window = environment, crypto, location, navigator } = environment;
  let rows = [], running = false, cancelled = false, cancelRequest = null;
  const current = () => !cancelled && isCurrent();
  const model = () => readonlyCopy({ running, rows: rows.map(row => ({ name: row.file.name,
    size: row.file.size, offset: row.offset, state: row.state, error: row.error })) });
  const publish = () => { if (current()) onChange(model()); };
  function guard() {
    if (!current()) throw new Error("已停止上傳。");
    if (Date.now() >= PHOTO_UPLOAD_DEADLINE) throw new Error("收相已截止；未完成的檔案不能繼續傳送。");
    if (!transport && (!enabled || location?.origin !== "https://lok274.github.io" || navigator?.onLine === false)) {
      throw new Error("預覽、測試或離線模式不能上傳。請在正式網站連線後操作。");
    }
  }
  function rpc(method, args) {
    guard();
    if (transport) return transport(method, args);
    return new Promise((resolve, reject) => {
      const id = hex(crypto.getRandomValues(new Uint8Array(16)));
      const frame = document.createElement("iframe");
      frame.name = "upload_" + id;
      frame.title = "上傳回覆";
      frame.hidden = true;
      const form = document.createElement("form");
      form.method = "POST";
      form.action = PHOTO_UPLOAD_ENDPOINT;
      form.target = frame.name;
      form.acceptCharset = "UTF-8";
      form.hidden = true;
      const payload = document.createElement("input");
      payload.type = "hidden";
      payload.name = "payload";
      payload.value = JSON.stringify({ id, method, args });
      form.append(payload);
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("message", receive);
        payload.value = "";
        form.remove(); frame.remove();
        cancelRequest = null;
      };
      const receive = event => {
        if (!/^https:\/\/(?:script\.google\.com|(?:[a-z0-9-]+-)?script\.googleusercontent\.com)$/.test(event.origin)) return;
        const reply = event.data;
        if (!reply || typeof reply !== "object" || Array.isArray(reply) || reply.id !== id || reply.method !== method || typeof reply.ok !== "boolean") return;
        if (reply.ok ? !reply.result || typeof reply.result !== "object" || Array.isArray(reply.result)
          : typeof reply.error !== "string" || !reply.error || reply.error.length > 400) return;
        cleanup();
        if (reply.ok) resolve(reply.result);
        else reject(new Error(reply.error));
      };
      const timer = window.setTimeout(() => { cleanup(); reject(new Error(uncertain)); }, 120000);
      cancelRequest = () => { cleanup(); reject(new Error("已停止上傳。")); };
      window.addEventListener("message", receive);
      document.body.append(frame, form);
      try { guard(); form.submit(); } catch (error) { cleanup(); reject(error); }
    });
  }
  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }
  async function retry(code) {
    if (running || cancelled) return;
    if (typeof code !== "string" || !code.trim()) throw new Error("請輸入收相人提供的固定上傳碼。");
    code = code.trim();
    guard();
    running = true;
    publish();
    try {
      for (const row of rows) {
        if (!current()) return;
        if (row.state === "saved") continue;
        row.state = "uploading"; row.error = ""; publish();
        try {
          guard();
          const prefix = row.file.slice(0, PREFIX_BYTES);
          if (!row.metadata) {
            const prefixSha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", await prefix.arrayBuffer())));
            row.metadata = Object.freeze({ name: row.file.name, mime: "image/jpeg", size: row.file.size, uploadKey: row.uploadKey, prefixSha256 });
          }
          if (!row.ticket) {
            const ticket = await rpc("prepareUpload", [code, row.metadata, await base64(prefix)]);
            if (!ticket || Object.entries(row.metadata).some(([key, value]) => ticket[key] !== value)
              || typeof ticket.fileId !== "string" || !/^[\w-]{10,200}$/.test(ticket.fileId)
              || !Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt > PHOTO_UPLOAD_DEADLINE
              || typeof ticket.signature !== "string" || !ticket.signature) throw new Error(uncertain);
            row.ticket = Object.freeze({ ...ticket });
          }
          if (row.ticket.expiresAt <= Date.now()) throw new Error("憑證已過期，請收相人核對 Drive 後才重新選取，避免重複。");
          let receipt = await rpc("getUploadStatus", [code, row.ticket]);
          while (current()) {
            if (!receipt || !Number.isSafeInteger(receipt.offset) || receipt.offset < row.offset || receipt.offset > row.file.size
              || !["saved", "uploading"].includes(receipt.status)
              || (receipt.status === "saved") !== (receipt.offset === row.file.size)) throw new Error(uncertain);
            row.offset = receipt.offset;
            if (receipt.status === "saved") { row.state = "saved"; break; }
            publish();
            const offset = row.offset;
            receipt = await rpc("uploadChunk", [code, row.ticket, offset, await base64(row.file.slice(offset, offset + CHUNK_BYTES))]);
            if (receipt?.offset <= offset) throw new Error(uncertain);
          }
        } catch (error) {
          if (!current()) return;
          row.state = "failed";
          // Server errors can contain request material; never echo the code or an untrusted error into the model.
          row.error = error.message.includes("截止") ? "收相已截止。" : error.message.includes("憑證已過期") ? "憑證已過期，請收相人核對 Drive 後才重新選取。" : uncertain;
          publish();
          break;
        }
        publish();
      }
    } finally { code = ""; running = false; publish(); }
  }
  async function start(files, code) {
    if (rows.length || running || cancelled) return;
    if (!Array.isArray(files) || !files.length || files.length > 30
      || files.some(file => !(file instanceof Blob) || file.type !== "image/jpeg" || !file.size || file.size > 2 * 1024 ** 3 || !/^photo-\d+\.jpg$/.test(file.name))) {
      throw new Error("每批只可上傳 1 至 30 張已準備的相簿 JPEG 相片。");
    }
    guard();
    rows = files.map(file => ({ file, uploadKey: hex(crypto.getRandomValues(new Uint8Array(16))),
      metadata: null, ticket: null, offset: 0, state: "queued", error: "" }));
    await retry(code);
  }
  function cancel() { cancelled = true; cancelRequest?.(); rows = []; }
  return { start, retry, cancel, getModel: model };
}
