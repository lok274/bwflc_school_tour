import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

test("real Wrangler local ASSETS serve admin without HTML rewrite loop", { timeout: 60000 }, async () => {
  const probe = createServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bwflc-push-assets-"));
  const environment = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(temporary, "wrangler.log") };
  for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "ADMIN_TOKEN"]) delete environment[key];
  const child = spawn(process.execPath, [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", temporary, "--log-level", "error", "--show-interactive-dev-session=false"], { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let exited = false; const exit = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  let diagnostics = ""; child.stdout.on("data", (bytes) => { diagnostics += bytes; }); child.stderr.on("data", (bytes) => { diagnostics += bytes; });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let n = 0; n < 150; n++) {
      if (exited) throw new Error(`Local Wrangler exited before ready: ${diagnostics}`);
      try { const response = await fetch(`${origin}/v1/config`); if (response.ok) { const config = await response.json(); assert.equal(config.enabled, false); ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "Local Wrangler did not become ready within the bounded startup window");
    const admin = await fetch(`${origin}/admin`, { redirect: "manual" }); assert.equal(admin.status, 200); assert.match(await admin.text(), /admin\.js/); assert.match(admin.headers.get("Content-Security-Policy"), /connect-src 'self'/);
    const slash = await fetch(`${origin}/admin/`, { redirect: "manual" }); assert.equal(slash.status, 307); assert.equal(slash.headers.get("Location"), "/admin");
    for (const file of ["admin.js", "admin.css"]) { const response = await fetch(`${origin}/${file}`, { redirect: "manual" }); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100); }
  } finally {
    if (!exited) child.kill("SIGTERM");
    await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (!exited) { child.kill("SIGKILL"); await exit; }
    if (!temporary.startsWith(path.join(os.tmpdir(), "bwflc-push-assets-"))) throw new Error("Invalid cleanup path");
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
