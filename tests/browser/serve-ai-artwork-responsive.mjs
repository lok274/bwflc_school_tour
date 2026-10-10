import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Test-only frames; the production server and release CSP stay unchanged.
const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.argv[2] || 42597);
const fixtures = new Set([
  "/styles.css", "/tests/browser/ai-artwork.html", "/tests/browser/ai-artwork.js",
  "/tests/browser/ai-artwork-responsive.html", "/tests/browser/ai-artwork-responsive.js",
  "/tests/browser/ai-artwork-responsive.css", "/tests/helpers/workbook-repository.js",
  "/tests/browser/check-in-card.html", "/tests/browser/check-in-card.js"
]);

createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + name);
    if (!file.startsWith(root)) throw new Error("Outside test workspace");
    if (!(/^\/src\/[a-zA-Z0-9./_-]+\.js$/.test(name) || fixtures.has(name))) {
      throw new Error("Outside fixture whitelist");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Synthetic responsive fixture: http://127.0.0.1:${port}/tests/browser/ai-artwork-responsive.html`);
});
