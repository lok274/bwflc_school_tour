import { DurableObject } from "cloudflare:workers";
import { RotationEngine, RotationError, configuration, authorizeTeacher } from "./rotation.js";
import { PAGE, STYLE, SCRIPT } from "./page.js";

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";
function response(body, status = 200, type = "application/json; charset=utf-8") {
  return new Response(type.startsWith("application/json") ? JSON.stringify(body) : body, { status, headers: {
    "Content-Type": type, "Cache-Control": "no-store", "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Vary": "Cookie",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()"
  } });
}
function failure(error) {
  return response({ error: error instanceof RotationError ? error.message : "憑證服務暫時未能使用，請稍後再試。" }, error instanceof RotationError ? error.status : 503);
}
export class AdminRotation extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.engine = new RotationEngine(ctx.storage, env); }
  async fetch(request) {
    try {
      configuration(this.env);
      if (request.method !== "POST") return response({ error: "要求不正確。" }, 405);
      const route = new URL(request.url).pathname;
      if (route === "/tick") return response(await this.engine.tick());
      if (route === "/credential") return response(await this.engine.credential());
      return response({ error: "找不到此功能。" }, 404);
    } catch (error) { return failure(error); }
  }
}
function state(env) { return env.ADMIN_ROTATION.get(env.ADMIN_ROTATION.idFromName("admin-rotation-v1")); }
export default {
  async scheduled(_controller, env) {
    if (env.ROTATION_ENABLED !== "true") return;
    configuration(env);
    const result = await state(env).fetch("https://rotation.internal/tick", { method: "POST" });
    if (!result.ok) throw new RotationError("老師憑證排程更新未完成；下次排程將重試。");
  },
  async fetch(request, env, ctx) {
    try {
      const config = configuration(env);
      await authorizeTeacher(ctx, config);
      const url = new URL(request.url);
      if (url.search || url.protocol !== "https:") throw new RotationError("要求網址不正確。", 400);
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) throw new RotationError("此網站不能領取憑證。", 403);
      if (request.method === "GET" && url.pathname === "/") return response(PAGE, 200, "text/html; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/page.css") return response(STYLE, 200, "text/css; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/page.js") return response(SCRIPT, 200, "text/javascript; charset=utf-8");
      if (request.method === "POST" && url.pathname === "/v1/credential") {
        if (origin !== url.origin || request.headers.get("Content-Type") !== "application/json" ||
            request.headers.get("Sec-Fetch-Site") === "cross-site") throw new RotationError("此網站不能領取憑證。", 403);
        // No request body is needed; cancel it without reading or retaining client data.
        await request.body?.cancel();
        return await state(env).fetch("https://rotation.internal/credential", { method: "POST" });
      }
      return response({ error: "找不到此功能。" }, 404);
    } catch (error) { return failure(error); }
  }
};
