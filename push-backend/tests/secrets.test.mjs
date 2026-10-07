import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { prepareLocalSecrets } from "../scripts/setup-local.mjs";
import { prepareProductionSecrets } from "../scripts/setup-production.mjs";

test("secret output refuses static-root/case variants, refuses overwrite and keeps production fixtures outside website", async () => {
  const project = fileURLToPath(new URL("../../", import.meta.url));
  await assert.rejects(prepareLocalSecrets({ destination: path.join(project, "public", "must-not-exist") }));
  if (process.platform === "win32") await assert.rejects(prepareProductionSecrets({ destination: path.join(project.toLowerCase(), "must-not-exist") }));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bwflc-push-secret-test-"));
  try {
    const production = await prepareProductionSecrets({ destination: path.join(temporary, "production"), generateKeys: () => ({ publicKey: "test-public", privateKey: "test-private" }), randomSecret: () => "test-admin" });
    assert.deepEqual(JSON.parse(await readFile(production.file, "utf8")), { VAPID_PUBLIC_KEY: "test-public", VAPID_PRIVATE_KEY: "test-private", ADMIN_TOKEN: "test-admin" });
    await assert.rejects(prepareProductionSecrets({ destination: path.join(temporary, "production"), generateKeys: () => ({ publicKey: "replace", privateKey: "replace" }), randomSecret: () => "replace" }), { code: "EEXIST" });
    assert.equal(JSON.parse(await readFile(production.file, "utf8")).ADMIN_TOKEN, "test-admin");
    const local = await prepareLocalSecrets({ destination: path.join(temporary, "local"), appUrl: "http://localhost:4193/" });
    const contents = await readFile(local.file, "utf8"); assert.match(contents, /ENVIRONMENT=local/); assert.match(contents, /APP_URL=http:\/\/localhost:4193\//);
    await assert.rejects(prepareLocalSecrets({ destination: path.join(temporary, "local"), appUrl: "http://localhost:4193/" }), { code: "EEXIST" });
    await assert.rejects(prepareLocalSecrets({ destination: path.join(temporary, "invalid"), appUrl: "https://example.com/" }));
  } finally { if (!temporary.startsWith(path.join(os.tmpdir(), "bwflc-push-secret-test-"))) throw new Error("Invalid cleanup path"); await rm(temporary, { recursive: true, force: true }); }
});
