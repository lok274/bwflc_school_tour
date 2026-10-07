import { mkdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function privateOutputDirectory(destination, name) {
  const project = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
  const target = path.resolve(destination ?? path.join(project, "..", name));
  const normalized = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const inside = (candidate) => normalized(candidate) === normalized(project) || normalized(candidate).startsWith(normalized(project + path.sep));
  if (inside(target)) throw new Error("秘密檔案不能放在網站或其子目錄。");
  let cursor = path.parse(target).root;
  for (const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (info?.isSymbolicLink()) throw new Error("秘密輸出路徑不能包含符號連結。");
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  const resolved = await realpath(target);
  if (inside(resolved)) throw new Error("秘密檔案不能放在網站或其子目錄。");
  return resolved;
}
