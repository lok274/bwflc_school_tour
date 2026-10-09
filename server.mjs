import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 4173);
// Read the static-host policy rather than maintaining a divergent second copy.
const indexDocument = await readFile(path.join(root, "index.html"), "utf8");
const documentPolicy = indexDocument.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if (!documentPolicy) throw new Error("缺少文件內容安全政策。 ");
const workerPolicy = "default-src 'none'; script-src 'self'; connect-src 'self'; object-src 'none'";
// The top-level native PDF reader uses an object for this exact approved file.
// HTML pages still prohibit all object/iframe embeds.
const bookletPolicy = "default-src 'none'; object-src 'self'; base-uri 'none'";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp"
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") pathname = "/index.html";

    const requestedPath = path.resolve(root, `.${pathname}`);
    if (!requestedPath.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let filePath = requestedPath;
    const details = await stat(filePath).catch(() => null);
    if (details?.isDirectory()) filePath = path.join(filePath, "index.html");

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": pathname === "/sw.js" ? "no-cache" : "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Content-Security-Policy": `${pathname === "/sw.js" ? workerPolicy : pathname === "/public/documents/trip-booklet-2026.pdf" ? bookletPolicy : documentPolicy}; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch (error) {
    const code = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(code === 404 ? "找不到頁面" : "伺服器發生錯誤");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`戶外學習日 PWA：http://localhost:${port}`);
});
