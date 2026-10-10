import test from "node:test";
import assert from "node:assert/strict";
import { RotationEngine, RotationError, configuration, authorizeTeacher, INTERVAL_MS, newSecret } from "../admin-rotation/rotation.js";

function fixture() {
  let clock = 1800000000000;
  const records = new Map(); const writes = []; let backendToken = newSecret();
  const storage = { async get(key) { return structuredClone(records.get(key)); }, async put(key, value) { records.set(key, structuredClone(value)); } };
  const env = {
    ROTATION_ENABLED: "true", TARGET_WORKER: "bwflc-school-tour-push", ADMIN_URL: "https://push.example.test/admin", CF_ACCOUNT_ID: "a".repeat(32), CF_API_TOKEN: "test-token-for-cloudflare-api-only",
    ACCESS_AUD: "test-audience-000000000000", TEACHER_EMAILS: "teacher@example.test",
    INITIAL_ADMIN_TOKEN: backendToken, ROTATION_ENCRYPTION_KEY: newSecret(),
    PUSH_BACKEND: { async fetch(url, options) {
      assert.equal(new URL(url).pathname, "/v1/admin/messages/00000000-0000-0000-0000-000000000000");
      assert.equal(options.method, "GET");
      return new Response(null, { status: options.headers.Authorization === `Bearer ${backendToken}` ? 404 : 401 });
    } }
  };
  const fetcher = async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.TARGET_WORKER}/secrets`);
    assert.equal(options.redirect, "manual"); assert.equal(options.headers.Authorization, `Bearer ${env.CF_API_TOKEN}`);
    const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ["name", "text", "type"]);
    assert.equal(body.name, "ADMIN_TOKEN"); assert.equal(body.type, "secret_text");
    writes.push(body.text); backendToken = body.text;
    return new Response(null, { status: 200 });
  };
  const engine = new RotationEngine(storage, env, { now: () => clock, fetcher });
  return { engine, env, storage, records, writes, fetcher, now: () => clock, advance: (ms) => { clock += ms; }, backend: () => backendToken, changeBackend: (token) => { backendToken = token; } };
}
test("rotation settings fail closed until enabled and all private configuration exists", () => {
  const f = fixture(); assert.equal(configuration(f.env).emails.has("teacher@example.test"), true);
  for (const key of ["TARGET_WORKER", "ADMIN_URL", "ROTATION_ENABLED", "CF_ACCOUNT_ID", "CF_API_TOKEN", "INITIAL_ADMIN_TOKEN", "ROTATION_ENCRYPTION_KEY", "ACCESS_AUD", "TEACHER_EMAILS", "PUSH_BACKEND"]) {
    assert.throws(() => configuration({ ...f.env, [key]: undefined }), RotationError);
  }
});
test("teacher authorization trusts only Access context, audience and private email allowlist", async () => {
  const config = configuration(fixture().env);
  const context = (email, aud = config.audience) => ({ access: { aud, getIdentity: async () => ({ email }) } });
  await authorizeTeacher(context("TEACHER@example.test"), config);
  for (const ctx of [{}, { "Cf-Access-Jwt-Assertion": "spoofed" }, context("other@example.test"), context("teacher@example.test", "wrong-audience"), context(undefined)]) {
    await assert.rejects(authorizeTeacher(ctx, config), RotationError);
  }
  await assert.rejects(authorizeTeacher({ access: { aud: config.audience, getIdentity: async () => { throw new Error("sensitive upstream failure"); } } }, config), (error) => !error.message.includes("sensitive"));
});
test("bootstrap validates backend and encrypts secrets before persistence; stale bootstrap fails", async () => {
  const f = fixture(); const value = await f.engine.credential();
  assert.equal(value.token, f.env.INITIAL_ADMIN_TOKEN); assert.equal(value.nextRotationAt, f.now() + INTERVAL_MS);
  assert.equal(f.writes.length, 0); assert.equal(JSON.stringify([...f.records.values()]).includes(value.token), false);
  const wrong = fixture(); wrong.changeBackend(newSecret());
  await assert.rejects(wrong.engine.credential(), RotationError); assert.equal(wrong.records.size, 0);
});
test("exact 90 day boundary changes only ADMIN_TOKEN once; VAPID and device data are never accessed", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS - 1);
  assert.equal((await f.engine.tick()).changed, false); assert.equal(f.writes.length, 0);
  f.advance(1); assert.equal((await f.engine.tick()).changed, true);
  const value = await f.engine.credential(); assert.notEqual(value.token, f.env.INITIAL_ADMIN_TOKEN);
  assert.equal(value.token, f.backend()); assert.equal(value.nextRotationAt, f.now() + INTERVAL_MS);
  assert.equal((await f.engine.tick()).changed, false); assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify([...f.records.values()]).includes(value.token), false);
});
test("failed write preserves encrypted candidate, allows verified current credential and retries same candidate", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS);
  let failing = true; const candidates = [];
  f.engine.fetcher = async (url, options) => {
    candidates.push(JSON.parse(options.body).text);
    if (failing) return new Response(null, { status: 503 });
    return f.fetcher(url, options);
  };
  await assert.rejects(f.engine.tick(), RotationError);
  const stillValid = await f.engine.credential(); assert.equal(stillValid.token, f.env.INITIAL_ADMIN_TOKEN); assert.equal(stillValid.rotationPending, true);
  assert.equal(f.backend(), f.env.INITIAL_ADMIN_TOKEN);
  assert.equal(JSON.stringify([...f.records.values()]).includes(candidates[0]), false);
  failing = false; await f.engine.tick(); assert.equal(candidates[0], candidates[1]);
  assert.equal((await f.engine.credential()).token, candidates[0]);
});
test("lost API response after applying candidate is reconciled without issuing another credential", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS);
  f.engine.fetcher = async (url, options) => { await f.fetcher(url, options); throw new Error("timed out after apply"); };
  assert.equal((await f.engine.tick()).changed, true); assert.equal(f.writes.length, 1);
  assert.equal((await f.engine.credential()).token, f.backend());
});
test("concurrent scheduled jobs serialize and cannot rotate twice or return an old credential", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS);
  const [first, second, value] = await Promise.all([f.engine.tick(), f.engine.tick(), f.engine.credential()]);
  assert.equal(first.changed, true); assert.equal(second.changed, false); assert.equal(f.writes.length, 1);
  assert.equal(value.token, f.backend());
});
test("restart after successful remote write but failed local commit recovers persisted candidate", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS);
  const put = f.storage.put; f.storage.put = async (key, value) => {
    if (!value.pending && value.rotatedAt === f.now()) throw new Error("storage unavailable");
    return put(key, value);
  };
  await assert.rejects(f.engine.tick()); assert.equal(f.writes.length, 1);
  f.storage.put = put;
  const restored = new RotationEngine(f.storage, f.env, { now: f.now, fetcher: f.fetcher });
  assert.equal((await restored.credential()).token, f.backend());
  assert.equal((await restored.tick()).changed, false); assert.equal(f.writes.length, 1);
});
test("wrong encryption key or externally changed backend credential fails closed", async () => {
  const f = fixture(); await f.engine.tick();
  const wrong = new RotationEngine(f.storage, { ...f.env, ROTATION_ENCRYPTION_KEY: newSecret() });
  await assert.rejects(wrong.credential(), RotationError);
  f.changeBackend(newSecret()); await assert.rejects(f.engine.credential(), RotationError);
  assert.equal(f.writes.length, 0);
});
test("Cloudflare redirect is never followed and cannot publish an unverified pending credential", async () => {
  const f = fixture(); await f.engine.tick(); f.advance(INTERVAL_MS);
  f.engine.fetcher = async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://untrusted.example.test/" } });
  };
  await assert.rejects(f.engine.tick(), RotationError);
  const value = await f.engine.credential(); assert.equal(value.token, f.env.INITIAL_ADMIN_TOKEN); assert.equal(value.rotationPending, true);
});
