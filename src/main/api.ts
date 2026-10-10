import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import { APP_NAME } from "./product";

type Handler = (ctx: ApiContext) => void | Promise<void>;

export interface ApiContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: string[];
  query: URLSearchParams;
}

export interface ApiDeps {
  listDevices: () => Promise<unknown[]>;
  connect: (serial: string) => Promise<{ ok: boolean; error?: string; name?: string }>;
  disconnect: () => Promise<void>;
  activateMirror: () => Promise<void>;
  recordToggle: () => Promise<{ recording: boolean }>;
  screenshot: () => Promise<{ ok: boolean; file?: string; error?: string }>;
  status: () => unknown;
  mirrors: () => unknown;
  activate?: (serial: string) => unknown;
  disconnectMirror?: (serial: string) => unknown;
}

const TOKEN_FILE = `${APP_NAME.toLowerCase()}-api-token`;

export function loadOrCreateToken(): string {
  const dir = `${process.env.HOME || "."}/.${APP_NAME.toLowerCase()}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = `${dir}/${TOKEN_FILE}`;
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(file, token, { mode: 0o600 });
    return token;
  } catch {
    return crypto.randomBytes(24).toString("hex");
  }
}

export function startLocalApi(deps: ApiDeps, port = 0): Promise<{ port: number; token: string }> {
  const token = loadOrCreateToken();
  const clients = new Set<http.ServerResponse>();

  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [
    {
      method: "GET",
      pattern: /^\/api\/status$/,
      keys: [],
      handler: (c) => json(c, deps.status()),
    },
    {
      method: "GET",
      pattern: /^\/api\/mirrors$/,
      keys: [],
      handler: (c) => json(c, deps.mirrors()),
    },
    {
      method: "GET",
      pattern: /^\/api\/devices$/,
      keys: [],
      handler: async (c) => json(c, await deps.listDevices()),
    },
    {
      method: "POST",
      pattern: /^\/api\/mirrors\/([A-Za-z0-9._:-]+)\/activate-by-serial$/,
      keys: ["serial"],
      handler: (c) => {
        const r = deps.activate ? deps.activate(c.params[0]) : { ok: false };
        json(c, r);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/events$/,
      keys: [],
      handler: (c) => {
        c.res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        c.res.write("event: open\ndata: {}\n\n");
        clients.add(c.res);
        c.req.on("close", () => clients.delete(c.res));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/mirrors\/(\d+)\/record$/,
      keys: ["n"],
      handler: async (c) => json(c, await deps.recordToggle()),
    },
    {
      method: "POST",
      pattern: /^\/api\/mirrors\/(\d+)\/activate$/,
      keys: ["n"],
      handler: async (c) => {
        await deps.activateMirror();
        json(c, { ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/mirrors\/(\d+)\/screenshot$/,
      keys: ["n"],
      handler: async (c) => json(c, await deps.screenshot()),
    },
    {
      method: "POST",
      pattern: /^\/api\/mirrors\/(\d+)\/disconnect$/,
      keys: ["n"],
      handler: async (c) => {
        await deps.disconnect();
        json(c, { ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/devices\/([A-Za-z0-9._:-]+)\/connect$/,
      keys: ["serial"],
      handler: async (c) => {
        const r = await deps.connect(c.params[0]);
        json(c, r, r.ok ? 200 : 400);
      },
    },
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const ctx: ApiContext = { req, res, params: [], query: url.searchParams };
    const supplied = url.searchParams.get("token") || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (supplied !== token) {
      json(ctx, { error: "unauthorized" }, 401);
      return;
    }
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m && r.method === req.method) {
        await r.handler({ ...ctx, params: m.slice(1) });
        return;
      }
    }
    json(ctx, { error: "not found" }, 404);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, token });
    });
  });
}

function json(ctx: ApiContext, body: unknown, status = 200) {
  const payload = JSON.stringify(body);
  ctx.res.writeHead(status, { "Content-Type": "application/json" });
  ctx.res.end(payload);
}