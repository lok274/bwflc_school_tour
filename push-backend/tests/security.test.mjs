import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { endpointUrl, settings, sha256, validateMessage, validateSubscription, readJson } from "../src/security.js";
import { encryptedRequest, sendEncrypted } from "../src/transport.js";
import { credentials, subscriber, decryptWebPush } from "./helpers.mjs";

test("endpoint allowlist rejects SSRF and keeps opaque genuine provider URLs", () => {
  for (const value of ["https://fcm.googleapis.com/wp/x", "https://updates.push.services.mozilla.com/wpush/opaque?x=y", "https://web.push.apple.com/QABC", "https://future.push.apple.com/opaque"]) assert.equal(endpointUrl(value).href, value);
  for (const value of ["http://fcm.googleapis.com/wp/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://localhost/x", "https://fcm.googleapis.com.attacker.test/x", "https://attackerpush.apple.com/x", "https://push.apple.com/x", "https://web.push.apple.com.attacker.test/x", "https://fcm.googleapis.com:444/x", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com/x#secret", "https://FCM.googleapis.com/x", "https://fcm.googleapis.com/", "https://fcm.googleapis.com/" + "x".repeat(2048)]) assert.throws(() => endpointUrl(value));
});
test("subscription validates actual P256 curve, canonical secrets, deterministic ownership and expiry", async () => {
  const fixture = subscriber(); const body = { subscription: fixture.subscription, managementToken: fixture.managementToken };
  const sub = await validateSubscription(body, 1000);
  assert.equal(sub.id, await sha256(fixture.subscription.endpoint)); assert.equal(sub.ownerHash, await sha256(fixture.managementToken));
  assert.equal(sub.expiresAt, 1000 + 30 * 86400000);
  assert.notEqual(sub.ownerHash, fixture.managementToken);
  const badPoint = Buffer.alloc(65); badPoint[0] = 4;
  await assert.rejects(validateSubscription({ ...body, subscription: { ...body.subscription, keys: { ...body.subscription.keys, p256dh: badPoint.toString("base64url") } } }));
  for (const token of ["x", fixture.managementToken + "=", " ".repeat(43)]) await assert.rejects(validateSubscription({ ...body, managementToken: token }));
  await assert.rejects(validateSubscription({ ...body, subscription: { ...body.subscription, expirationTime: 999 } }, 1000));
  await assert.rejects(validateSubscription({ ...body, photo: "never accepted" }));
});
test("config fails closed for absent secrets, incorrect key pair, permissive dev origins and invalid scope", () => {
  const env = credentials(); assert.equal(settings(env).enabled, true);
  assert.equal(settings({ APP_URL: env.APP_URL, APP_ORIGIN: env.APP_ORIGIN }).enabled, false);
  assert.equal(settings({ ...env, VAPID_PRIVATE_KEY: credentials().VAPID_PRIVATE_KEY }).enabled, false);
  assert.equal(settings({ ...env, APP_URL: env.APP_URL + "#home" }).enabled, false);
  assert.equal(settings({ ...env, APP_URL: "http://localhost:4173/", APP_ORIGIN: "http://localhost:4173" }).enabled, false);
  assert.equal(settings({ ...env, ENVIRONMENT: "local", LOCAL_DEV_ORIGINS: "*" }).enabled, false);
  assert.equal(settings({ ...env, LOCAL_DEV_ORIGINS: "*" }).enabled, true); // Production ignores the development-only setting.
});
test("announcement schema excludes arbitrary links, HTML fields, personal blob fields and oversized unicode", () => {
  assert.deepEqual(validateMessage({ title: " 公告 ", body: "請查看行程。" }), { title: "公告", body: "請查看行程。", route: "home" });
  for (const value of [{ title: "x", body: "x", route: "prepare" }, { title: "x", body: "x", route: "https://attacker.test" }, { title: "x", body: "x", url: "https://attacker.test" }, { title: "x", body: "x", html: "<b>x</b>" }, { title: "😀".repeat(81), body: "x" }, { title: "x", body: "字".repeat(601) }, { title: "x", body: "" }, { title: "x\0", body: "x" }, { title: "x", body: "\ud800".repeat(600) }]) assert.throws(() => validateMessage(value));
});
test("JSON request limit applies even with chunked body and rejects wrong media type", async () => {
  await assert.rejects(readJson(new Request("https://worker.test", { method: "POST", body: "{}" })), { status: 415 });
  await assert.rejects(readJson(new Request("https://worker.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(8193) })), { status: 413 });
  await assert.rejects(readJson(new Request("https://worker.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), { status: 400 });
});
test("stalled body has a total deadline, is cancelled and releases its reader lock", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const request = new Request("https://worker.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" });
  await assert.rejects(readJson(request, 10), { status: 408, code: "request_timeout" });
  assert.equal(cancelled, true); assert.equal(request.body.locked, false);
});
test("real encrypted request decrypts independently and signed VAPID has correct audience", async () => {
  const env = credentials(); const fixture = subscriber();
  const subscription = await validateSubscription({ subscription: fixture.subscription, managementToken: fixture.managementToken });
  const now = Date.now(); const message = { id: crypto.randomUUID(), title: "老師公告", body: "請查看更新行程。", route: "itinerary", createdAt: now, expiresAt: now + 60000 };
  const request = encryptedRequest(subscription, message, settings(env).vapid, now);
  assert.equal(request.redirect, "manual"); assert.equal(request.headers.get("Content-Encoding"), "aes128gcm"); assert.equal(request.headers.get("TTL"), "60");
  const clear = decryptWebPush(await request.arrayBuffer(), fixture); assert.equal(clear.body, message.body); assert.equal(clear.route, "itinerary");
  assert.equal(Object.hasOwn(clear, "subscription"), false);
  const authorization = request.headers.get("Authorization");
  const token = /t=([^, ]+)/.exec(authorization)[1]; const segments = token.split(".");
  const claims = JSON.parse(Buffer.from(segments[1], "base64url"));
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.ok(claims.exp <= now / 1000 + 86401);
  const raw = Buffer.from(env.VAPID_PUBLIC_KEY, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(segments.slice(0, 2).join(".")), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(segments[2], "base64url")), true);
});
test("transport classifies accepted, gone, auth failure, retry and bounded Retry-After without returning provider bodies", async () => {
  const env = credentials(); const fixture = subscriber(); const sub = await validateSubscription({ subscription: fixture.subscription, managementToken: fixture.managementToken });
  const now = Date.now(); const message = { id: crypto.randomUUID(), title: "x", body: "x", route: "home", createdAt: now, expiresAt: now + 86400000 };
  for (const [status, expected] of [[201, "accepted"], [410, "gone"], [404, "gone"], [401, "failed"], [403, "failed"], [400, "failed"], [307, "failed"], [429, "retry"], [503, "retry"]]) {
    const result = await sendEncrypted(sub, message, settings(env).vapid, { fetchImpl: async (request) => { assert.equal(request.redirect, "manual"); return new Response("sensitive endpoint", { status, headers: { "Retry-After": "999999" } }); } });
    assert.equal(result.outcome, expected); assert.equal(Object.hasOwn(result, "body"), false); if (expected === "retry") assert.equal(result.retryAfterMs, 3600000);
  }
  assert.equal((await sendEncrypted(sub, message, settings(env).vapid, { fetchImpl: async () => { throw new Error("network"); } })).code, "network_error");
});
