import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const execute = promisify(execFile);
export async function bundleWorker(config = "wrangler.jsonc") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bwflc-push-bundle-"));
  try {
    // This is Wrangler's real deployment bundle/config validation, without a deploy.
    const environment = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(temporary, "wrangler.log") };
    delete environment.CLOUDFLARE_API_TOKEN; delete environment.CLOUDFLARE_API_KEY; delete environment.CLOUDFLARE_EMAIL;
    await execute(process.execPath, [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "deploy", "--config", config, "--dry-run", "--outdir", temporary], { cwd: root, env: environment, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    const entries = (await readdir(temporary)).filter((file) => file.endsWith(".js"));
    if (entries.length !== 1) throw new Error("Wrangler did not emit exactly one Worker bundle.");
    return await readFile(path.join(temporary, entries[0]), "utf8");
  } finally {
    if (!temporary.startsWith(path.join(os.tmpdir(), "bwflc-push-bundle-"))) throw new Error("Invalid temporary bundle cleanup path");
    await rm(temporary, { recursive: true, force: true });
  }
}
