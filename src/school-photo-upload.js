import { readonlyCopy } from "./store.js";
import { MAX_TRIP_MEDIA_BATCH, MAX_TRIP_VIDEO_BYTES, MEDIA_EXTENSIONS, MEDIA_PREFIX_BYTES, mediaKind } from "./trip-media-types.js";

export const PHOTO_UPLOAD_ENDPOINT = "https://script.google.com/macros/s/AKfycbyAxiBEgnO4CA3r-9fc5OuXLXgoSmRq0lcrlsmw4HPhD3jWuTefanXBGoJmWt5H60ZY/exec";
export const PHOTO_UPLOAD_DEADLINE = Date.parse("2026-11-09T23:59:00+08:00");
const CHUNK_BYTES = 4 * 1024 * 1024;
const uncertain = "未能確認儲存。請保留此頁，重新輸入同一上傳碼後按重試，先核對進度。";
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function createSchoolPhotoUpload({ environment = globalThis, enabled = true, isCurrent = () => true,
  onChange = () => {}, transport, mediaEnabled = false } = {}) {
  const { window = environment, crypto, location, navigator } = environment;
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
      const abort = new AbortController();
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        abort.abort();
        if (cancelRequest === cancel) cancelRequest = null;
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => finish(new Error("已停止上傳。"));
      const timer = window.setTimeout(() => finish(new Error(uncertain)), 120000);
      cancelRequest = cancel;
      void (async () => {
        try {
          guard();
          const response = await environment.fetch(PHOTO_UPLOAD_ENDPOINT, { method: "POST", mode: "cors", credentials: "omit", redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ id, method, args }),
            signal: abort.signal, cache: "no-store", referrerPolicy: "no-referrer" });
          if (settled) return;
          guard();
          const url = new URL(response.url);
          if (!response.ok || !["basic", "cors", "default"].includes(response.type)
            || !(url.href === PHOTO_UPLOAD_ENDPOINT || url.origin === "https://script.googleusercontent.com"
              && url.pathname === "/macros/echo" && url.search && !url.hash && !url.username && !url.password)) throw new Error(uncertain);
          const text = await response.text();
          if (settled) return;
          guard();
          if (text.length > 65536) throw new Error(uncertain);
          const reply = JSON.parse(text);
          if (!reply || typeof reply !== "object" || Array.isArray(reply) || reply.id !== id || reply.method !== method || typeof reply.ok !== "boolean"
            || (reply.ok ? !reply.result || typeof reply.result !== "object" || Array.isArray(reply.result) || Object.hasOwn(reply, "error")
              : typeof reply.error !== "string" || !reply.error || reply.error.length > 400 || Object.hasOwn(reply, "result"))) throw new Error(uncertain);
          finish(reply.ok ? null : new Error(reply.error), reply.result);
        } catch (error) { finish(error); }
      })();
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
          const prefix = row.file.slice(0, MEDIA_PREFIX_BYTES);
          if (!row.metadata) {
            const prefixSha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", await prefix.arrayBuffer())));
            row.metadata = Object.freeze({ name: row.file.name, mime: row.file.type, size: row.file.size, uploadKey: row.uploadKey, prefixSha256 });
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
          row.error = error.message === "上傳碼不正確，請向收相人確認。" ? "上傳碼不正確，請向收相人確認後重新輸入。"
            : error.message.includes("截止") ? "收相已截止。" : error.message.includes("憑證已過期") ? "憑證已過期，請收相人核對 Drive 後才重新選取。" : uncertain;
          publish();
          break;
        }
        publish();
      }
    } finally { code = ""; running = false; publish(); }
  }
  async function start(files, code) {
    if (rows.length || running || cancelled) return;
    const message = mediaEnabled ? "每批只可上傳 1 至 30 項已準備的相簿檔案。" : "每批只可上傳 1 至 30 張已準備的相簿 JPEG 相片。";
    if (!Array.isArray(files) || !files.length || files.length > MAX_TRIP_MEDIA_BATCH) throw Error(message);
    files = files.map(file => {
      const blob = mediaEnabled ? file?.blob : file;
      const type = mediaEnabled ? file?.mime : file?.type;
      const extension = Object.hasOwn(MEDIA_EXTENSIONS, type) && MEDIA_EXTENSIONS[type];
      const name = file?.name;
      if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_TRIP_VIDEO_BYTES
        || !extension || !mediaEnabled && type !== "image/jpeg"
        || !new RegExp(`^${mediaKind(type)}-[0-9]+\\.${extension}$`).test(name)) throw Error(message);
      return { name, type, size: blob.size, slice: (start, end) => blob.slice(start, end) };
    });
    guard();
    rows = files.map(file => ({ file, uploadKey: hex(crypto.getRandomValues(new Uint8Array(16))),
      metadata: null, ticket: null, offset: 0, state: "queued", error: "" }));
    await retry(code);
  }
  function cancel() { cancelled = true; cancelRequest?.(); rows = []; }
  return { start, retry, cancel, getModel: model };
}
