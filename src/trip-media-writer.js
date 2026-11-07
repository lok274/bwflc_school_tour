// Dedicated worker also supports Safari versions without an async writable stream.
self.addEventListener("message", async ({ data: { folderName, id, blob } }) => {
  try {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(folderName);
    const handle = await folder.getFileHandle(id, { create: true });
    const writer = await handle.createSyncAccessHandle();
    try {
      const chunkSize = 4 * 1024 ** 2;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        if (writer.write(bytes, { at: offset }) !== bytes.length) throw Error("影片未能完整寫入。");
      }
      writer.flush();
    } finally { writer.close(); }
    self.postMessage({ saved: true });
  } catch (error) {
    self.postMessage({ error: error.name });
  }
}, { once: true });
