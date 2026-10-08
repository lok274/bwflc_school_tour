import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildPages } from "../scripts/build-pages.mjs";

test("Pages 發布包只包含網站資產並拒絕覆蓋舊目錄", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "outdoor-pages-test-"));
  try {
    const files = await buildPages(temporary);
    assert.equal(files.length, 38);
    for (const file of files) assert.ok((await stat(path.join(temporary, file))).isFile());
    for (const file of ["AGENTS.md", "README.md", "server.mjs", "package.json", "tests", ".github", "push-backend"]) {
      await assert.rejects(stat(path.join(temporary, file)), { code: "ENOENT" });
    }
    await assert.rejects(buildPages(temporary), /必須為空/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("PWA 啟動、圖示及離線資產保留 GitHub Pages 子目錄", async () => {
  const base = new URL("https://example.github.io/learning-trip/");
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  for (const relative of [manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]) {
    assert.ok(new URL(relative, base).pathname.startsWith(base.pathname));
  }
  const events = {};
  let cached;
  const context = vm.createContext({ URL, Request, self: {
    registration: { scope: base.href }, skipWaiting() {},
    addEventListener: (name, callback) => { events[name] = callback; }
  }, caches: { open: async () => ({ addAll: async (files) => { cached = files; } }) } });
  vm.runInContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), context);
  await new Promise((resolve, reject) => events.install({ waitUntil: (task) => task.then(resolve, reject) }));
  for (const asset of cached) {
    assert.equal(asset.cache, "reload", "新版離線快取必須重新驗證資產，不能沿用 HTTP 舊快取");
    assert.ok(new URL(asset.url).pathname.startsWith(base.pathname));
  }
  const app = await readFile(new URL("../src/controller.js", import.meta.url), "utf8");
  assert.ok(app.includes('new URL("../sw.js", import.meta.url)'));
  assert.ok(app.includes("serviceWorker.register(workerUrl)"));
});
