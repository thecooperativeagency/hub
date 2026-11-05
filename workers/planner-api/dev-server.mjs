import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryD1 } from "./d1-shim.js";
import { createApp } from "./src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = createApp();
const env = { DB: createMemoryD1() };
const port = Number(process.env.PORT || 8787);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function blocked(pathname) {
  const parts = pathname.split("/");
  return parts.includes("..") || parts.includes(".git") || parts.includes("node_modules") || pathname.includes(".dev.vars");
}

createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${port}`;
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null || key.toLowerCase() === "host") continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const init = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = Buffer.concat(chunks);
      const response = await app.fetch(new Request(url, init), env);
      const headersOut = {};
      response.headers.forEach((value, key) => {
        headersOut[key] = value;
      });
      res.writeHead(response.status, headersOut);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\0") || blocked(pathname)) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }
    let filePath = path.resolve(root, `.${pathname}`);
    if (pathname === "/") filePath = path.join(root, "index.html");
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    console.log(JSON.stringify({ level: "error", message: String(err && err.message || err) }));
    if (!res.headersSent) res.writeHead(500);
    res.end("server");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`fixture planner on http://127.0.0.1:${port}/planner.html`);
});
