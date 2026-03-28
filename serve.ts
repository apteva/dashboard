import { $ } from "bun";
import { spawn } from "bun";
import { createServer } from "net";
import { watch } from "fs";
import { resolve } from "path";

const ROOT_DIR = resolve(import.meta.dir);
const DB_PATH = resolve(ROOT_DIR, "apteva-server.db");
const DATA_DIR = resolve(ROOT_DIR, "data");

const SERVER_CMD = process.env.SERVER_CMD || "../server/apteva-server";
const CORE_CMD = process.env.CORE_CMD || "../core/apteva-core";

// Find a free port starting from the given one
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(start, () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => {
      resolve(findFreePort(start + 1));
    });
  });
}

// Step 1: Always rebuild binaries and dashboard
console.log("Building apteva-core...");
await $`cd ../core && go build -o apteva-core .`;

console.log("Building apteva-server...");
await $`cd ../server && go build -o apteva-server .`;

console.log("Building dashboard...");
await $`bun run build.ts`.quiet();

// Step 3: Find free ports
const SERVER_PORT = await findFreePort(parseInt(process.env.SERVER_PORT || "5280"));
const DASHBOARD_PORT = await findFreePort(parseInt(process.env.PORT || "5284"));

// Step 4: Start server (which can spawn core instances)
console.log(`Starting apteva-server on :${SERVER_PORT}...`);
const serverAbsCmd = resolve(ROOT_DIR, SERVER_CMD);
const coreAbsCmd = resolve(ROOT_DIR, CORE_CMD);

const serverProc = spawn({
  cmd: [serverAbsCmd],
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    PORT: String(SERVER_PORT),
    CORE_CMD: coreAbsCmd,
    DB_PATH: DB_PATH,
    DATA_DIR: DATA_DIR,
  },
  stdout: "inherit",
  stderr: "inherit",
});

// Give server time to start
await Bun.sleep(500);

// Step 5: Serve dashboard + proxy to server
const dashboard = Bun.serve({
  port: DASHBOARD_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Proxy API routes → server
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/instances") || url.pathname.startsWith("/provider-types") || url.pathname.startsWith("/providers") || url.pathname.startsWith("/mcp-servers") || url.pathname.startsWith("/mcp/") || url.pathname.startsWith("/webhooks/") || url.pathname.startsWith("/subscriptions") || url.pathname.startsWith("/integrations/catalog") || url.pathname.startsWith("/connections") || url.pathname.startsWith("/projects") || url.pathname.startsWith("/telemetry") || url.pathname.startsWith("/health")) {
      const target = `http://localhost:${SERVER_PORT}${url.pathname}${url.search}`;
      try {
        const resp = await fetch(new Request(target, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        }));
        return new Response(resp.body, {
          status: resp.status,
          headers: resp.headers,
        });
      } catch {
        return new Response("server unreachable", { status: 502 });
      }
    }

    // Serve static files from dist/
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./dist${filePath}`);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback
    return new Response(Bun.file("./dist/index.html"));
  },
});

// Cleanup on exit
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  serverProc.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  serverProc.kill();
  process.exit(0);
});

// Watch src/ for changes and auto-rebuild dashboard
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
watch("./src", { recursive: true }, (_event, filename) => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    console.log(`\n  Rebuilding dashboard (${filename} changed)...`);
    try {
      await $`bun run build.ts`.quiet();
      console.log("  Rebuild complete.");
    } catch (e) {
      console.error("  Rebuild failed:", e);
    }
  }, 300);
});

console.log(`
  ◆ Apteva Dashboard

  dashboard:  http://localhost:${dashboard.port}
  server:     http://localhost:${SERVER_PORT}

  Watching src/ for changes...
  Ctrl+C to stop
`);
