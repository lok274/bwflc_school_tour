import webpush from "web-push";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { privateOutputDirectory } from "./private-output.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareLocalSecrets({ destination, appUrl = "http://localhost:4173/" } = {}) {
  const url = new URL(appUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hash || url.search || !url.pathname.endsWith("/")) throw new Error("本機設定只接受 loopback App 網址。");
  const resolved = await privateOutputDirectory(destination, "bwflc-push-private");
  const file = path.join(resolved, "local-secrets.env");
  // Refuse to overwrite a previously generated key pair; subscriptions depend on it.
  const keys = webpush.generateVAPIDKeys();
  const content = `ENVIRONMENT=local\nAPP_URL=${url.href}\nAPP_ORIGIN=${url.origin}\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nADMIN_TOKEN=${randomBytes(32).toString("base64url")}\nVAPID_SUBJECT=https://github.com/lok274/bwflc_school_tour\n`;
  await writeFile(file, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { file, appUrl: url.href };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareLocalSecrets({ destination: process.argv[2], appUrl: process.argv[3] });
    console.log(`本機測試設定已保存於 ${result.file}；未輸出任何密鑰。Windows 使用目前使用者的檔案權限，請勿分享此檔案。`);
    console.log("這些設定只用於本機；正式服務請另行設定 provider secrets。 ");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
