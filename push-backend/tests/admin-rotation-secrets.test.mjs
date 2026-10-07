import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAdminRotation } from "../scripts/setup-admin-rotation.mjs";
import { newSecret } from "../admin-rotation/rotation.js";

test("rotation setup preserves original push keys, writes private email/config once and rejects website paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bwflc-rotation-secrets-"));
  try {
    const productionFile = path.join(directory, "production.json");
    const original = { ADMIN_TOKEN: newSecret(), VAPID_PRIVATE_KEY: "unchanged-private", VAPID_PUBLIC_KEY: "unchanged-public" };
    await writeFile(productionFile, JSON.stringify(original));
    const options = { productionFile, destination: path.join(directory, "output"), accountId: "a".repeat(32), teacherEmails: ["teacher@example.test"] };
    const { file } = await prepareAdminRotation(options); const value = JSON.parse(await readFile(file, "utf8"));
    assert.equal(value.INITIAL_ADMIN_TOKEN, original.ADMIN_TOKEN); assert.equal(value.TEACHER_EMAILS, "teacher@example.test");
    assert.equal(value.CF_API_TOKEN, ""); assert.equal(value.ACCESS_AUD, ""); assert.equal(value.ROTATION_ENCRYPTION_KEY.length, 43);
    assert.equal(Object.hasOwn(value, "VAPID_PRIVATE_KEY"), false); assert.deepEqual(JSON.parse(await readFile(productionFile, "utf8")), original);
    await assert.rejects(prepareAdminRotation(options), { code: "EEXIST" });
    await assert.rejects(prepareAdminRotation({ ...options, destination: fileURLToPath(new URL("../admin-rotation/", import.meta.url)) }), /不能放在網站/);
    await assert.rejects(prepareAdminRotation({ ...options, productionFile: fileURLToPath(new URL("../package.json", import.meta.url)) }), /不能放在網站/);
    const malformed = path.join(directory, "malformed.json");
    await writeFile(malformed, '{"ADMIN_TOKEN":"sensitive-invalid-credential-value"');
    await assert.rejects(prepareAdminRotation({ ...options, productionFile: malformed }), (error) => /JSON 格式不正確/.test(error.message) && !error.message.includes("sensitive-invalid"));
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("bwflc-rotation-secrets-")) throw new Error("Invalid cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
