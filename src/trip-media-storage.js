const NAMESPACE = "outdoorLearningDay.tripMedia.v1";
const RECORDS = "media", SETTINGS = "settings";
const VIDEO_DIRECTORY = "outdoor-learning-trip-videos-v1";

export function createTripMediaStorage({ indexedDB, navigator, Worker, crypto } = globalThis) {
  let opening;
  function open() {
    if (!indexedDB || !navigator?.locks) throw Error("此瀏覽器不支援獨立相簿儲存。");
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAMESPACE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(RECORDS, { keyPath: "id" });
        request.result.createObjectStore(SETTINGS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transaction(stores, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result?.result);
      tx.onabort = () => reject(tx.error || Error("儲存操作已停止。"));
      try { result = action(tx); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  const readRecords = () => transaction(RECORDS, "readonly", tx => tx.objectStore(RECORDS).getAll());
  const generation = async () => (await transaction(SETTINGS, "readonly", tx => tx.objectStore(SETTINGS).get("generation"))) || "";
  async function directory(create = false) {
    if (!navigator?.storage?.getDirectory || !Worker) {
      if (create) throw Error("此瀏覽器不支援儲存影片，請用較新版本。");
      return null;
    }
    const root = await navigator.storage.getDirectory();
    try { return await root.getDirectoryHandle(VIDEO_DIRECTORY, { create }); }
    catch (error) { if (error.name === "NotFoundError" && !create) return null; throw error; }
  }
  async function removeVideo(folder, id) {
    try { await folder?.removeEntry(id); }
    catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  function lock(action) {
    if (!indexedDB || !navigator?.locks) throw Error("此瀏覽器不支援獨立相簿儲存。");
    return navigator.locks.request(NAMESPACE, action);
  }
  async function cleanOrphans(records) {
    const folder = await directory();
    if (!folder) return;
    const saved = new Set(records.filter(item => item.kind === "video").map(item => item.id));
    for await (const id of folder.keys()) {
      if (!saved.has(id)) await removeVideo(folder, id);
    }
  }
  function writeVideo(id, blob, signal) {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./trip-media-writer.js", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      const finish = error => {
        worker.terminate();
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(signal.reason);
      worker.onmessage = ({ data }) => {
        if (data.saved) finish();
        else if (data.error === "QuotaExceededError") finish(new DOMException("儲存空間不足。", data.error));
        else finish(Error("影片未能完整儲存，請檢查可用空間及瀏覽器支援。"));
      };
      worker.onerror = () => finish(Error("此瀏覽器未能儲存影片。"));
      signal.addEventListener("abort", abort, { once: true });
      try { worker.postMessage({ folderName: VIDEO_DIRECTORY, id, blob }); }
      catch (error) { finish(error); }
    });
  }
  async function list() {
    return lock(async () => {
      const records = await readRecords();
      // A failed cleanup must not hide already saved items.
      try { await cleanOrphans(records); } catch {}
      return { generation: await generation(), items: records.map(({ blob, ...item }) => item).sort((a, b) => b.createdAt - a.createdAt) };
    });
  }
  async function save(item, blob, expectedGeneration, signal) {
    return lock(async () => {
      signal.throwIfAborted();
      if (await generation() !== expectedGeneration) throw Error("旅程資料已在其他分頁清除，請重新選取。");
      const record = { ...item, id: crypto.randomUUID(), createdAt: Date.now(), size: blob.size };
      let folder;
      try {
        if (record.kind === "video") {
          folder = await directory(true);
          await writeVideo(record.id, blob, signal);
        } else record.blob = blob;
        signal.throwIfAborted();
        await transaction(RECORDS, "readwrite", tx => tx.objectStore(RECORDS).add(record));
      } catch (error) {
        try { await removeVideo(folder, record.id); } catch {}
        throw error;
      }
    });
  }
  async function get(id) {
    const record = await transaction(RECORDS, "readonly", tx => tx.objectStore(RECORDS).get(id));
    if (!record) throw Error("找不到檔案，可能已在另一分頁移除。");
    if (record.blob) return record.blob;
    const folder = await directory();
    const file = await (await folder?.getFileHandle(id))?.getFile();
    if (!file || file.size !== record.size) throw Error("影片檔案未能讀取。");
    return file;
  }
  async function remove(id) {
    return lock(async () => {
      const record = await transaction(RECORDS, "readonly", tx => tx.objectStore(RECORDS).get(id));
      await transaction(RECORDS, "readwrite", tx => tx.objectStore(RECORDS).delete(id));
      if (record?.kind === "video") await removeVideo(await directory(), id);
    });
  }
  async function clear() {
    if (!indexedDB || !navigator?.locks) return;
    return lock(async () => {
      await transaction([RECORDS, SETTINGS], "readwrite", tx => {
        tx.objectStore(RECORDS).clear();
        tx.objectStore(SETTINGS).put(crypto.randomUUID(), "generation");
      });
      await cleanOrphans([]);
    });
  }
  return { list, save, get, remove, clear };
}
