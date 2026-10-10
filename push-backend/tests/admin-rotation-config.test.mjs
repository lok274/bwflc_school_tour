import test from "node:test";
import assert from "node:assert/strict";
import { rotationDeploymentSettings, verifyRotationSettings, configureAdminRotation } from "../scripts/configure-admin-rotation.mjs";
import { deploymentConfiguration, RotationEngine, newSecret } from "../admin-rotation/rotation.js";
import { renderPage } from "../admin-rotation/page.js";

test("公開部署設定一致性核對拒絕錯誤 Worker、綁定及管理網址", async () => {
  const expected = rotationDeploymentSettings("another-push", "https://push.example.test/");
  const backend = { name: "another-push" };
  const config = { vars: { ...expected }, services: [{ binding: "PUSH_BACKEND", service: "another-push" }] };
  assert.deepEqual(verifyRotationSettings(backend, config, "https://push.example.test/"), expected);
  for (const value of [
    { ...config, vars: { ...expected, TARGET_WORKER: "wrong-worker" } },
    { ...config, vars: { ...expected, ADMIN_URL: "https://wrong.example.test/admin" } },
    { ...config, services: [{ binding: "PUSH_BACKEND", service: "wrong-worker" }] },
    { ...config, services: [...config.services, ...config.services] }
  ]) assert.throws(() => verifyRotationSettings(backend, value, "https://push.example.test/"), /不一致/);
  await configureAdminRotation();
});

test("設定只接受明確的 Worker 名稱及 HTTPS 管理網址，頁面網址經 HTML 編碼", () => {
  for (const name of [undefined, "../other", "target/secrets", "", "x".repeat(64)]) {
    assert.throws(() => deploymentConfiguration({ TARGET_WORKER: name, ADMIN_URL: "https://push.example.test/admin" }));
  }
  for (const url of [undefined, "javascript:alert(1)", "http://push.example.test/admin", "https://name:password@push.example.test/admin", "https://push.example.test/admin?token=secret", "https://push.example.test/admin#fragment", "https://push.example.test/other"]) {
    assert.throws(() => deploymentConfiguration({ TARGET_WORKER: "valid-push", ADMIN_URL: url }));
  }
  assert.match(renderPage('" onmouseover="test'), /href="&quot; onmouseover=&quot;test"/);
  assert.doesNotMatch(renderPage('" onmouseover="test'), /href="" onmouseover=/);
});

test("現有加密關聯資料保持相容，換目標不能讀取舊憑證", async () => {
  const env = { CF_ACCOUNT_ID: "a".repeat(32), TARGET_WORKER: "bwflc-school-tour-push", ADMIN_URL: "https://push.example.test/admin", ROTATION_ENCRYPTION_KEY: newSecret() };
  const engine = new RotationEngine({}, env);
  assert.equal(new TextDecoder().decode(engine.aad()), `bwflc.admin.rotation.v1:${env.CF_ACCOUNT_ID}:bwflc-school-tour-push`);
  const token = newSecret(), sealed = await engine.seal(token);
  assert.equal(await new RotationEngine({}, { ...env }).open(sealed), token);
  await assert.rejects(new RotationEngine({}, { ...env, TARGET_WORKER: "another-push" }).open(sealed));
});
