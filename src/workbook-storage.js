import { WORKBOOK_ACTIVITY, WORKBOOK_FORMAT, emptyWorkbook, validateWorkbook } from "./workbook-data.js";

export class WorkbookConflict extends Error {
  constructor() { super("另一分頁已修改手冊，已暫停保存以避免覆蓋。"); this.name = "WorkbookConflict"; }
}
export function createWorkbookRepository({ indexedDB = globalThis.indexedDB, databaseName = "outdoorLearningDay.workbook.v1" } = {}) {
  const open = () => new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error("瀏覽器未能使用本機手冊儲存，請下載備份。")); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => reject(new Error("未能開啟手冊草稿庫。"));
    request.onblocked = () => reject(new Error("手冊草稿庫被另一分頁佔用，請關閉舊分頁再試。"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  function normalize(record) {
    if (!record) return { revision: 0, draft: emptyWorkbook() };
    if (record.format !== WORKBOOK_FORMAT || record.activity !== WORKBOOK_ACTIVITY || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("本機手冊版本不相容，未有改動原資料。");
    return { revision: record.revision, draft: validateWorkbook(record.draft) };
  }
  async function transact(mode, prepare) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result, error;
      const transaction = db.transaction("drafts", mode), store = transaction.objectStore("drafts");
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(error || new Error("未能完成手冊儲存交易。")); };
      const request = store.get(WORKBOOK_ACTIVITY);
      request.onsuccess = () => {
        try { result = prepare(store, normalize(request.result)); }
        catch (cause) { error = cause; transaction.abort(); }
      };
    });
  }
  const put = (store, revision, draft) => {
    if (!Number.isSafeInteger(revision + 1)) throw new Error("手冊版本數值無效。");
    store.put({ format: WORKBOOK_FORMAT, activity: WORKBOOK_ACTIVITY, revision: revision + 1, draft }, WORKBOOK_ACTIVITY);
    return { revision: revision + 1, draft };
  };
  return {
    read: () => transact("readonly", (_store, current) => current),
    write: (draft, expectedRevision) => {
      const checked = validateWorkbook(draft);
      return transact("readwrite", (store, current) => {
        if (current.revision !== expectedRevision) throw new WorkbookConflict();
        return put(store, current.revision, checked);
      });
    },
    // Keep a versioned empty record: a stale tab must not resurrect a cleared draft.
    clear: () => transact("readwrite", (store, current) => put(store, current.revision, emptyWorkbook()))
  };
}

// Serial queue with transaction-confirmed status, revision CAS and a reset barrier.
export function createWorkbookSession({ repository, onChange = () => {} }) {
  let draft = emptyWorkbook(), revision = 0, edit = 0, savedEdit = 0, generation = 0;
  let status = "loading", error = "", running = null, stopped = false, initialized = false;
  const notify = () => onChange();
  const snapshot = () => ({ draft: structuredClone(draft), revision, edit, status, error, initialized, dirty: edit !== savedEdit });
  async function load() {
    const token = ++generation;
    status = "loading"; error = ""; notify();
    try {
      const record = await repository.read();
      if (token !== generation) return;
      draft = record.draft; revision = record.revision; edit = savedEdit = 0;
      initialized = true; stopped = false; status = "saved";
    } catch (cause) { if (token === generation) { status = "error"; error = cause.message; } }
    notify();
  }
  function schedule() {
    if (running || stopped || !initialized || ["conflict", "error", "loading"].includes(status) || edit === savedEdit) return;
    const token = generation;
    running = Promise.resolve().then(async () => {
      while (!stopped && token === generation && edit !== savedEdit) {
        const savingEdit = edit, data = validateWorkbook(draft);
        status = "saving"; notify();
        try {
          const record = await repository.write(data, revision);
          if (token !== generation) break;
          revision = record.revision; savedEdit = savingEdit;
          status = edit === savedEdit ? "saved" : "saving"; error = "";
        } catch (cause) {
          if (token === generation) { status = cause instanceof WorkbookConflict ? "conflict" : "error"; error = cause.message; }
          break;
        }
        notify();
      }
    }).finally(() => { running = null; notify(); });
  }
  function replace(next) {
    if (!initialized || status === "loading") return false;
    draft = validateWorkbook(next); edit++; if (!["conflict", "error"].includes(status)) status = "saving";
    notify(); schedule(); return true;
  }
  async function flush() {
    schedule();
    while (running) await running;
    if (edit !== savedEdit || !initialized || ["error", "conflict"].includes(status)) throw new Error(error || "手冊仍未保存，請先重試或下載備份。");
    return snapshot();
  }
  async function retry() {
    if (status === "conflict") return;
    if (!initialized) { await load(); return; }
    if (stopped) {
      if (!await checkStoppedVersion()) return;
      stopped = false;
    }
    status = "saving"; error = ""; schedule(); notify();
    try { await flush(); } catch { /* status and draft preserved */ }
  }
  async function checkVersion() {
    if (!initialized || stopped) return false;
    await running;
    const token = generation;
    try {
      const record = await repository.read();
      if (token !== generation) return false;
      if (record.revision !== revision) { status = "conflict"; error = "另一分頁已修改或清除手冊。先備份目前內容，再載入另一分頁版本。"; notify(); return false; }
      return true;
    } catch (cause) { status = "error"; error = cause.message; notify(); return false; }
  }
  async function checkStoppedVersion() {
    try {
      const record = await repository.read();
      if (record.revision !== revision) { status = "conflict"; error = "儲存版本已改動。先備份目前內容，再載入已保存版本。"; notify(); return false; }
      return true;
    } catch (cause) { status = "error"; error = cause.message; notify(); return false; }
  }
  async function stop() {
    stopped = true; generation++; await running;
    status = "error"; error = "清除程序尚未完成，手冊待存工作已暫停。輸入仍保留，可重試保存或下載備份。"; notify();
  }
  async function clear() {
    await stop();
    try {
      const record = await repository.clear();
      draft = record.draft; revision = record.revision; edit = savedEdit = 0;
      stopped = false; initialized = true; status = "saved"; error = ""; notify();
    } catch (cause) { status = "error"; error = "未能清除手冊草稿；已停止待存工作。"; notify(); throw cause; }
  }
  return { snapshot, load, replace, flush, retry, checkVersion, stop, clear };
}
