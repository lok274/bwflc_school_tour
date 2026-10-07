import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configFile = "src/push-config.js";
const policyFiles = ["index.html", "tests/browser/security.html"];

export function normalizePushUrl(value) {
  if (value === "") return "";
  const url = new URL(value);
  const hostname = url.hostname;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/" || (url.port && url.port !== "443")
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
      || hostname.endsWith(".localhost")) throw new Error("只接受正式推送後台的 HTTPS 根網址，不能含憑證、查詢、子路徑或本機地址。");
  return url.origin + "/";
}

export async function verifyPushPolicy(root = projectRoot) {
  const source = await readFile(path.join(root, configFile), "utf8");
  const literal = source.match(/apiBaseUrl:\s*("(?:\\.|[^"\\])*")/)?.[1];
  if (!literal) throw new Error("通知設定格式無效。");
  const configured = JSON.parse(literal);
  const normalized = normalizePushUrl(configured);
  if (configured !== normalized) throw new Error("通知後台網址必須是標準 HTTPS 根網址。");
  const expected = normalized ? new URL(normalized).origin : "'none'";
  for (const file of policyFiles) {
    const html = await readFile(path.join(root, file), "utf8");
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    if (policy?.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1].trim() !== expected)
      throw new Error(file + " 的 CSP 與通知後台設定不一致。");
  }
  return { apiBaseUrl: normalized, connectSource: expected };
}

export async function configurePush(value, root = projectRoot) {
  const apiBaseUrl = normalizePushUrl(value);
  const connectSource = apiBaseUrl ? new URL(apiBaseUrl).origin : "'none'";
  const updates = [];
  for (const file of policyFiles) {
    const html = await readFile(path.join(root, file), "utf8");
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    if (!policy || (policy.match(/(?:^|;)\s*connect-src\s+[^;]+/g) || []).length !== 1)
      throw new Error(file + " 缺少唯一的 CSP 連線來源。");
    const updated = policy.replace(/((?:^|;)\s*connect-src\s+)[^;]+/, "$1" + connectSource);
    updates.push([file, html.replace(policy, updated)]);
  }
  await readFile(path.join(root, configFile), "utf8");
  const config = "// Public notification configuration; never put secrets in this file.\n"
    + "export const PUSH_CONFIG = Object.freeze({ apiBaseUrl: " + JSON.stringify(apiBaseUrl) + " });\n";
  updates.push([configFile, config]);
  for (const [file, body] of updates) await writeFile(path.join(root, file), body);
  await verifyPushPolicy(root);
  return { apiBaseUrl, connectSource };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("用法：node scripts/configure-push.mjs https://你的後台網址/；關閉時傳入空字串。");
  const result = await configurePush(process.argv[2]);
  console.log(result.apiBaseUrl ? "已設定通知後台與精確 CSP。發布前仍須測試及更新離線快取版本。" : "已停用通知後台連線。");
}
