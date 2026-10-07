import { createECDH, randomBytes, createDecipheriv, hkdfSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import webpush from "web-push";
import { PushRepository } from "../src/repository.js";

export function credentials() {
  const vapid = webpush.generateVAPIDKeys();
  return { APP_ORIGIN: "https://lok274.github.io", APP_URL: "https://lok274.github.io/bwflc_school_tour/", VAPID_SUBJECT: "https://github.com/lok274/bwflc_school_tour", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, ADMIN_TOKEN: randomBytes(32).toString("base64url") };
}
export function subscriber(path = crypto.randomUUID()) {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { subscription: { endpoint: `https://fcm.googleapis.com/wp/${path}`, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }, managementToken: randomBytes(32).toString("base64url"), ecdh, auth };
}
export function repository(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  const storage = {
    sql: { exec(sql, ...values) { const statement = db.prepare(sql); const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []); return { toArray: () => rows }; } },
    transactionSync(callback) { db.exec("BEGIN"); try { const result = callback(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
  };
  const repo = new PushRepository(storage); repo.initialize(); return { repo, db };
}
// Independent RFC8291 receiver using Node primitives, not the sender's helper/package.
export function decryptWebPush(bytes, subscriber) {
  const body = Buffer.from(bytes); const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16); const keyLength = body[20];
  if (recordSize !== 4096 || keyLength !== 65) throw new Error("Unexpected record framing");
  const serverPublic = body.subarray(21, 21 + keyLength);
  const shared = subscriber.ecdh.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), subscriber.ecdh.getPublicKey(), serverPublic]);
  const ikm = hkdfSync("sha256", shared, subscriber.auth, info, 32);
  const key = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const record = body.subarray(21 + keyLength);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce); decipher.setAuthTag(record.subarray(-16));
  const clear = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  let end = clear.length - 1; while (clear[end] === 0) end--;
  if (clear[end] !== 2) throw new Error("Invalid final-record delimiter");
  return JSON.parse(clear.subarray(0, end).toString("utf8"));
}
