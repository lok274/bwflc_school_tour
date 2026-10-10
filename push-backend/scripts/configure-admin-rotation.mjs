import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUSH_CONFIG } from "../../src/push-config.js";
import { deploymentConfiguration } from "../admin-rotation/rotation.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export function rotationDeploymentSettings(workerName, apiBaseUrl) {
  const base = new URL(apiBaseUrl);
  if (base.href !== `${base.origin}/` || base.protocol !== "https:") throw new Error("推送網址必須是完整 HTTPS 根網址。");
  const vars = { TARGET_WORKER: workerName, ADMIN_URL: new URL("admin", base).href };
  deploymentConfiguration(vars);
  return Object.freeze(vars);
}
export function verifyRotationSettings(backend, rotation, apiBaseUrl) {
  const expected = rotationDeploymentSettings(backend.name, apiBaseUrl);
  const services = rotation.services?.filter(item => item.binding === "PUSH_BACKEND") || [];
  if (services.length !== 1 || services[0].service !== expected.TARGET_WORKER ||
      rotation.vars?.TARGET_WORKER !== expected.TARGET_WORKER || rotation.vars?.ADMIN_URL !== expected.ADMIN_URL) {
    throw new Error("憑證服務的目標、服務綁定或管理網址不一致；請執行 node scripts/configure-admin-rotation.mjs --write 後重新核對。");
  }
  return expected;
}
export async function configureAdminRotation({ write = false } = {}) {
  // Only public deployment settings are read here; private credentials are never needed.
  const backend = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  const file = path.join(root, "admin-rotation", "wrangler.jsonc");
  const rotation = JSON.parse(await readFile(file, "utf8"));
  if (write) {
    const expected = rotationDeploymentSettings(backend.name, PUSH_CONFIG.apiBaseUrl);
    const binding = rotation.services?.find(item => item.binding === "PUSH_BACKEND");
    if (!binding) throw new Error("憑證服務缺少 PUSH_BACKEND 服務綁定。");
    binding.service = expected.TARGET_WORKER;
    rotation.vars = { ...rotation.vars, ...expected };
    verifyRotationSettings(backend, rotation, PUSH_CONFIG.apiBaseUrl);
    await writeFile(file, `${JSON.stringify(rotation, null, 2)}\n`);
  }
  return verifyRotationSettings(backend, rotation, PUSH_CONFIG.apiBaseUrl);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await configureAdminRotation({ write: process.argv.includes("--write") });
  console.log("憑證服務的公開部署設定已核對；沒有讀取秘密或連接正式後台。");
}
