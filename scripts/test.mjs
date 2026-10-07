import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep the browser app tests separate from the backend's runtime and dependencies.
const root = fileURLToPath(new URL("../", import.meta.url));
const files = (await readdir(new URL("../tests/", import.meta.url)))
  .filter(name => name.endsWith(".test.mjs")).sort().map(name => `tests/${name}`);
if (!files.length) throw new Error("找不到應用測試。");
const child = spawn(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit", shell: false });
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
