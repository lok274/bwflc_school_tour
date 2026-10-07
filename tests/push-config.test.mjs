import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizePushUrl, configurePush, verifyPushPolicy } from "../scripts/configure-push.mjs";

const sourceRoot = new URL("../", import.meta.url);
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tour-push-config-"));
  for (const file of ["index.html", "src/push-config.js", "tests/browser/security.html"]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(new URL(file, sourceRoot), path.join(root, file));
  }
  return root;
}

test("推送設定僅接受正式 HTTPS 根網址", () => {
  assert.equal(normalizePushUrl(""), "");
  assert.equal(normalizePushUrl("https://school-push.example.com"), "https://school-push.example.com/");
  for (const value of ["http://push.example.com/", "https://localhost/", "https://127.0.0.1/", "https://[::1]/",
    "https://push.example.com/v1/", "https://push.example.com/?token=secret", "https://push.example.com/#fragment",
    "https://user:password@push.example.com/", "https://push.example.com:8443/", "https://foo.localhost/"]) {
    assert.throws(() => normalizePushUrl(value), undefined, value);
  }
});

test("設定和 CSP 同步，停用還原 none，錯配拒絕發布", async () => {
  const root = await fixture();
  try {
    await configurePush("https://school-push.example.com/", root);
    assert.deepEqual(await verifyPushPolicy(root), { apiBaseUrl: "https://school-push.example.com/", connectSource: "https://school-push.example.com" });
    for (const file of ["index.html", "tests/browser/security.html"]) {
      assert.match(await readFile(path.join(root, file), "utf8"), /connect-src https:\/\/school-push\.example\.com;/);
    }
    assert.doesNotMatch(await readFile(path.join(root, "src/push-config.js"), "utf8"), /managementToken|ADMIN_TOKEN|PRIVATE_KEY/);
    const file = path.join(root, "index.html");
    await writeFile(file, (await readFile(file, "utf8")).replace("connect-src https://school-push.example.com", "connect-src *"));
    await assert.rejects(verifyPushPolicy(root), /不一致/);
    await configurePush("", root);
    assert.equal((await verifyPushPolicy(root)).connectSource, "'none'");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("無效設定不修改檔案", async () => {
  const root = await fixture();
  try {
    const before = await readFile(path.join(root, "src/push-config.js"), "utf8");
    await assert.rejects(configurePush("https://evil.example/?secret=value", root));
    assert.equal(await readFile(path.join(root, "src/push-config.js"), "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
