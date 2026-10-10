import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundleWorker } from "../scripts/bundle-worker.mjs";
import { newSecret } from "../admin-rotation/rotation.js";

let bundle;
async function options(access, persistence) {
  bundle ??= bundleWorker("admin-rotation/wrangler.jsonc");
  const token = newSecret();
  const env = { ROTATION_ENABLED: "true", TARGET_WORKER: "synthetic-push-test", ADMIN_URL: "https://push.example.test/admin", CF_ACCOUNT_ID: "a".repeat(32), CF_API_TOKEN: "test-cloudflare-api-token-only", ACCESS_AUD: "test-audience-000000000000", TEACHER_EMAILS: "teacher@example.test", INITIAL_ADMIN_TOKEN: token, ROTATION_ENCRYPTION_KEY: newSecret() };
  const result = convertV4MiniflareOptions({ name: "rotation-test", modules: true, script: await bundle, compatibilityDate: "2026-06-25", bindings: env, access,
    durableObjects: { ADMIN_ROTATION: { className: "AdminRotation", useSQLite: true } }, durableObjectsPersist: persistence,
    cf: false, host: "127.0.0.1", outboundService: () => { throw new Error("No rotation or external API writes before 90 days"); },
    serviceBindings: { PUSH_BACKEND: (request) => new RuntimeResponse(null, { status: request.headers.get("Authorization") === `Bearer ${env.INITIAL_ADMIN_TOKEN}` ? 404 : 401 }) }
  });
  return { result, env };
}
test("actual Worker denies missing Access identity and spoofed JWT headers before reaching storage", { timeout: 60000 }, async () => {
  const { result } = await options(undefined); const mf = new Miniflare(result);
  try {
    await mf.ready;
    const denied = await mf.dispatchFetch("https://rotation.test/", { headers: { "Cf-Access-Jwt-Assertion": "spoofed", "Cf-Access-Authenticated-User-Email": "teacher@example.test" } });
    assert.equal(denied.status, 401); assert.equal(denied.headers.get("Cache-Control"), "no-store");
    assert.equal((await denied.text()).includes("token"), false);
  } finally { await mf.dispose(); }
});
test("actual Access context + SQLite Worker retrieves privately, rejects CSRF, and survives restart", { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bwflc-rotation-runtime-"));
  const { result, env } = await options({ aud: "test-audience-000000000000", identity: { email: "teacher@example.test" } }, temporary);
  result.resourcePersistencePath = temporary;
  let mf;
  const retrieve = (headers = {}) => mf.dispatchFetch("https://rotation.test/v1/credential", { method: "POST", headers: { Origin: "https://rotation.test", "Content-Type": "application/json", ...headers }, body: "{}" });
  try {
    mf = new Miniflare(result); await mf.ready;
    const page = await mf.dispatchFetch("https://rotation.test/"); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /每 90 天/); assert.ok(html.includes(`href="${env.ADMIN_URL}"`));
    assert.match(page.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
    const response = await retrieve(); assert.equal(response.status, 200); const first = await response.json(); assert.equal(first.token, env.INITIAL_ADMIN_TOKEN);
    assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal((await retrieve({ Origin: "https://untrusted.example.test" })).status, 403);
    assert.equal((await retrieve({ "Content-Type": "text/plain" })).status, 403);
    assert.equal((await mf.dispatchFetch("https://rotation.test/v1/credential")).status, 404);
    assert.equal((await mf.dispatchFetch("https://rotation.test/tick", { method: "POST" })).status, 404);
    assert.equal((await mf.dispatchFetch("https://rotation.test/?token=anything")).status, 400);
    await mf.dispose(); mf = new Miniflare(result); await mf.ready;
    const restored = await (await retrieve()).json(); assert.deepEqual(restored, first);
  } finally {
    await mf?.dispose();
    const resolved = path.resolve(temporary); const expected = path.resolve(os.tmpdir());
    if (!resolved.startsWith(expected + path.sep) || !path.basename(resolved).startsWith("bwflc-rotation-runtime-")) throw new Error("Invalid temporary cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
test("actual Access context with unauthorized teacher or wrong audience is rejected", { timeout: 60000 }, async () => {
  for (const [access, status] of [[{ aud: "test-audience-000000000000", identity: { email: "other@example.test" } }, 403], [{ aud: "wrong-audience-0000000000", identity: { email: "teacher@example.test" } }, 401]]) {
    const { result } = await options(access); const mf = new Miniflare(result);
    try { await mf.ready; assert.equal((await mf.dispatchFetch("https://rotation.test/")).status, status); }
    finally { await mf.dispose(); }
  }
});
