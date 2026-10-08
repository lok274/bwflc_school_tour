import test from "node:test";
import assert from "node:assert/strict";
import { repository, subscriber, credentials } from "./helpers.mjs";
import { createRegistrationProof, REGISTRATION_PROOF_TTL, sha256, validateSubscription, verifyRegistrationProof } from "../src/security.js";
import { MAX_SUBSCRIPTIONS, MAX_TOMBSTONES } from "../src/repository.js";

async function fixture(repo, now, suffix = crypto.randomUUID()) {
  const device = subscriber(suffix); const env = credentials();
  const sub = await validateSubscription({ subscription: device.subscription, managementToken: device.managementToken }, now);
  const keyId = await sha256(env.VAPID_PUBLIC_KEY);
  const ticket = await createRegistrationProof(sub, keyId, repo.registrationEpoch(), env.VAPID_PRIVATE_KEY, now);
  const proof = verifyRegistrationProof(ticket, sub.id, sub.ownerHash, keyId, env.VAPID_PRIVATE_KEY);
  return { sub, keyId, ticket, proof, env };
}
function seedLegacy(repo, sub, keyId, count, now) {
  for (let n = 1; n <= count; n++) repo.sql.exec("INSERT INTO subscriptions(id,endpoint,p256dh,auth,ownerHash,keyId,version,createdAt,updatedAt,expiresAt,verified) VALUES (?,?,?,?,?,?,?,?,?,?,0)", n.toString(16).padStart(64,"0"), sub.endpoint + n, sub.p256dh, sub.auth, sub.ownerHash, keyId, "legacy", now, now, now + 86400000);
}

test("fabricated registrations and over10000 unknown deletes reserve no persistent capacity", async () => {
  const { repo, db } = repository();
  try {
    const { sub, keyId, proof } = await fixture(repo, 1000);
    for (let n = 0; n < MAX_SUBSCRIPTIONS + 1; n++) assert.throws(() => repo.register({ ...sub, id: n.toString(16).padStart(64,"0"), endpoint: sub.endpoint + n }, keyId, 1000), { code: "verification_required" });
    for (let n = 0; n < MAX_TOMBSTONES + 1; n++) repo.remove(n.toString(16).padStart(64,"0"), "self-chosen", 1000);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM subscriptions").n, 0);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM tombstones").n, 0);
    repo.register(sub, keyId, 1001, proof);
    repo.remove(sub.id, sub.ownerHash, 1002);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM subscriptions").n, 0);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM tombstones").n, 1);
  } finally { db.close(); }
});

test("every receipt field and owner binding is authenticated; no expired or absent proof renewal", async () => {
  const { repo, db } = repository();
  try {
    const { sub, keyId, ticket, proof, env } = await fixture(repo, 1000);
    for (let n = 0; n < 6; n++) {
      const parts = ticket.split("."); parts[n] = parts[n].replace(/.$/, ch => ch === "a" ? "b" : "a");
      assert.throws(() => verifyRegistrationProof(parts.join("."), sub.id, sub.ownerHash, keyId, env.VAPID_PRIVATE_KEY));
    }
    for (const [id, owner, key] of [["f".repeat(64),sub.ownerHash,keyId],[sub.id,"f".repeat(64),keyId],[sub.id,sub.ownerHash,"f".repeat(64)]]) assert.throws(() => verifyRegistrationProof(ticket,id,owner,key,env.VAPID_PRIVATE_KEY));
    assert.throws(() => repo.register(sub,keyId,proof.expiresAt,proof), { code: "verification_expired" });
    repo.register(sub,keyId,1001,proof);
    assert.throws(() => repo.register({ ...sub, auth: "changed" },keyId,1002), { code: "verification_required" });
    repo.remove(sub.id,sub.ownerHash,1002);
    assert.throws(() => repo.register(sub,keyId,1003,proof), { code: "subscription_cancelled" });
    repo.cleanup(1003 + REGISTRATION_PROOF_TTL);
    assert.throws(() => repo.register(sub,keyId,1004 + REGISTRATION_PROOF_TTL), { code: "verification_required" });
  } finally { db.close(); }
});

test("known-owner cancellation succeeds at a saturated pool and atomically invalidates all old receipts", async () => {
  const { repo, db } = repository();
  try {
    const known = await fixture(repo,1000); const late = await fixture(repo,1000);
    repo.register(known.sub,known.keyId,1000,known.proof);
    const message = repo.createMessage({title:"control",body:"control",route:"home"},crypto.randomUUID(),"hash",1000,known.sub.id);
    for(let n=0;n<MAX_TOMBSTONES;n++) repo.sql.exec("INSERT INTO tombstones(id,ownerHash,expiresAt) VALUES (?,?,?)", n.toString(16).padStart(64,"0"),"legacy-junk",86400000);
    const epoch = repo.registrationEpoch();
    assert.throws(() => repo.remove(known.sub.id,"wrong-owner",1001,known.proof), { status:401 });
    assert.equal(repo.registrationEpoch(),epoch);
    repo.remove(known.sub.id,known.sub.ownerHash,1001);
    assert.notEqual(repo.registrationEpoch(),epoch);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM tombstones").n,1);
    assert.equal(repo.one("SELECT id FROM subscriptions WHERE id = ?",known.sub.id),undefined);
    assert.equal(repo.status(message.jobId).expired,1);
    assert.throws(() => repo.register(late.sub,late.keyId,1002,late.proof), { code:"verification_expired" });
    repo.remove(late.sub.id,late.sub.ownerHash,1002,late.proof);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM tombstones").n,1);
    const refreshed = verifyRegistrationProof(await createRegistrationProof(late.sub,late.keyId,repo.registrationEpoch(),late.env.VAPID_PRIVATE_KEY,1003),late.sub.id,late.sub.ownerHash,late.keyId,late.env.VAPID_PRIVATE_KEY);
    repo.remove(late.sub.id,late.sub.ownerHash,1003,refreshed);
    assert.throws(() => repo.register(late.sub,late.keyId,1004,refreshed), { code:"subscription_cancelled" });
  } finally { db.close(); }
});

test("bounded pre-upgrade rows retain consented delivery without crowding out confirmed admission", async () => {
  const { repo, db } = repository();
  try {
    const { sub,keyId,proof } = await fixture(repo,1000);
    seedLegacy(repo,sub,keyId,MAX_SUBSCRIPTIONS,1000);
    const legacy=repo.one("SELECT * FROM subscriptions LIMIT 1");
    const message=repo.createMessage({title:"legacy control",body:"control",route:"home"},crypto.randomUUID(),"hash",1000,legacy.id);
    assert.throws(() => repo.register(legacy,keyId,1001), {code:"verification_required"});
    assert.throws(() => repo.register(sub,keyId,1001), {code:"verification_required"});
    repo.register(sub,keyId,1001,proof);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM subscriptions").n,MAX_SUBSCRIPTIONS+1);
    assert.deepEqual(repo.one("SELECT * FROM subscriptions WHERE id = ?",legacy.id),legacy);
    assert.equal(repo.status(message.jobId).pending,1);
    assert.equal(repo.one("SELECT verified FROM subscriptions WHERE id = ?",sub.id).verified,1);
    repo.register(sub,keyId,1002); // An unchanged confirmed recipient can renew without another notification.
    for(let n=1;n<MAX_SUBSCRIPTIONS;n++) repo.register({...sub,id:"f".repeat(60)+n.toString(16).padStart(4,"0"),endpoint:sub.endpoint+"/confirmed/"+n},keyId,1002,proof);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM subscriptions").n,2*MAX_SUBSCRIPTIONS);
    assert.throws(() => repo.register({...sub,id:"e".repeat(64),endpoint:sub.endpoint+"/full"},keyId,1003,proof),{code:"capacity_reached"});
    assert.throws(() => repo.register(legacy,keyId,1003,proof),{code:"capacity_reached"});
    repo.register(sub,keyId,1003); // Renewal of a confirmed owner still works at capacity.
    repo.cleanup(1000+86400000);
    assert.equal(repo.one("SELECT id FROM subscriptions WHERE id = ?",legacy.id),undefined);
    assert.equal(repo.one("SELECT COUNT(*) AS n FROM subscriptions").n,MAX_SUBSCRIPTIONS);
    const epoch=repo.registrationEpoch(); repo.initialize(); assert.equal(repo.registrationEpoch(),epoch);
  } finally { db.close(); }
});
