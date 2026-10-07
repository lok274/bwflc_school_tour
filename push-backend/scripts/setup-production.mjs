import webpush from "web-push";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateOutputDirectory } from "./private-output.mjs";

// Called by the operator only after production provisioning has been authorized.
// The CLI writes once to a private sibling directory, never to the Pages source root.
export async function prepareProductionSecrets({ destination, generateKeys = () => webpush.generateVAPIDKeys(), randomSecret = () => randomBytes(32).toString("base64url") } = {}) {
  const directory = await privateOutputDirectory(destination, "bwflc-push-private-production");
  const file = path.join(directory, "production-secrets.json");
  const keys = generateKeys();
  await writeFile(file, JSON.stringify({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, ADMIN_TOKEN: randomSecret() }, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { file };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareProductionSecrets({ destination: process.argv[2] });
    console.log(`正式密鑰已寫入 ${result.file}；沒有印出密鑰。請私下保管，Windows 使用目前使用者的檔案權限。`);
    console.log("此動作只產生本機秘密檔案，未登入、上傳或部署任何服務。 ");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
