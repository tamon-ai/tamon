import { describe, it, expect, afterEach } from "vitest";
import { WebhookServer } from "./server";

let server: WebhookServer | null = null;

async function startServer(opts: { port?: number; authToken?: string } = {}): Promise<number> {
  const port = opts.port || 0;
  server = new WebhookServer({ ...opts, port });
  // ポート0で空きポートを自動取得したいが、WebhookServerはlisten後のアドレス取得APIがない
  // 固定ポートを使う
  const actualPort = port || 19876;
  if (!port) {
    server = new WebhookServer({ ...opts, port: actualPort });
  }
  await server.start();
  return actualPort;
}

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

describe("WebhookServer", () => {
  it("responds 404 for unknown routes", async () => {
    const port = await startServer();
    const res = await fetch(`http://localhost:${port}/nope`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("handles GET routes", async () => {
    const port = await startServer();
    server!.get("/health", async (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("handles POST routes with body", async () => {
    const port = await startServer();
    server!.post("/echo", async (_req, res, body) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    });

    const res = await fetch(`http://localhost:${port}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe("hello");
  });

  it("responds 204 to CORS preflight", async () => {
    const port = await startServer();
    const res = await fetch(`http://localhost:${port}/any`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
  });

  it("rejects unauthorized requests when authToken set", async () => {
    const port = await startServer({ authToken: "secret123" });
    server!.get("/protected", async (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    const res = await fetch(`http://localhost:${port}/protected`);
    expect(res.status).toBe(401);
  });

  it("accepts Bearer token in Authorization header", async () => {
    const port = await startServer({ authToken: "secret123" });
    server!.get("/protected", async (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    const res = await fetch(`http://localhost:${port}/protected`, {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts token as query parameter", async () => {
    const port = await startServer({ authToken: "secret123" });
    server!.get("/protected", async (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    const res = await fetch(`http://localhost:${port}/protected?token=secret123`);
    expect(res.status).toBe(200);
  });

  it("returns 500 when handler throws", async () => {
    const port = await startServer();
    server!.get("/boom", async () => {
      throw new Error("handler error");
    });

    const res = await fetch(`http://localhost:${port}/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
