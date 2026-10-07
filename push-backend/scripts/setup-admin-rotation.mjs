import { readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { privateOutputDirectory } from "./private-output.mjs";

export async function prepareAdminRotation({ productionFile, destination, accountId, teacherEmails } = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "")) throw new Error("請提供 Cloudflare 帳戶識別碼。");
  if (!Array.isArray(teacherEmails) || !teacherEmails.length || teacherEmails.length > 50 ||
      teacherEmails.some((email) => typeof email !== "string" || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))) throw new Error("請提供老師電郵白名單。");
  if (!productionFile) throw new Error("請指定原有正式密鑰檔案。");
  const source = path.resolve(productionFile);
  await privateOutputDirectory(path.dirname(source), "bwflc-push-private-production");
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("原有密鑰來源不能是符號連結。");
  const contents = await readFile(source, "utf8");
  let production;
  try { production = JSON.parse(contents); }
  catch { throw new Error("原有私人密鑰檔案的 JSON 格式不正確，請在本機修正。"); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(production.ADMIN_TOKEN || "")) throw new Error("原有老師憑證格式不正確。");
  const directory = await privateOutputDirectory(destination, "bwflc-admin-rotation-private");
  const file = path.join(directory, "rotation-secrets.json");
  await writeFile(file, JSON.stringify({
    CF_ACCOUNT_ID: accountId, CF_API_TOKEN: "", ACCESS_AUD: "",
    TEACHER_EMAILS: [...new Set(teacherEmails.map((email) => email.toLowerCase()))].join(","),
    INITIAL_ADMIN_TOKEN: production.ADMIN_TOKEN, ROTATION_ENCRYPTION_KEY: randomBytes(32).toString("base64url")
  }, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { file };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareAdminRotation({ productionFile: process.argv[2], destination: process.argv[3], accountId: process.env.ROTATION_ACCOUNT_ID, teacherEmails: (process.env.ROTATION_TEACHER_EMAILS || "").split(",").filter(Boolean) });
    console.log(`私人設定檔已建立：${result.file}。請在本機補齊 Cloudflare API Token 及 Access audience，沒有印出密鑰或老師電郵。`);
    console.log("原有 ADMIN_TOKEN 及 VAPID 均未更換；此動作沒有上傳或啟用排程。");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
