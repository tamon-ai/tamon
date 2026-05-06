import { createServer, type IncomingMessage, type ServerResponse } from "http";
import * as logger from "../../utils/logger";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => Promise<void>;

export interface WebhookServerOptions {
  port?: number;
  authToken?: string;
  corsOrigins?: string[];
}

export class WebhookServer {
  private routes = new Map<string, Map<string, RouteHandler>>();
  private port: number;
  private authToken: string;
  private corsOrigins: string[];
  private server: ReturnType<typeof createServer> | null = null;

  constructor(options: WebhookServerOptions = {}) {
    this.port = options.port || 3456;
    this.authToken = options.authToken || "";
    this.corsOrigins = options.corsOrigins || ["*"];
  }

  route(method: string, path: string, handler: RouteHandler): void {
    const upper = method.toUpperCase();
    if (!this.routes.has(upper)) this.routes.set(upper, new Map());
    this.routes.get(upper)!.set(path, handler);
  }

  get(path: string, handler: RouteHandler): void {
    this.route("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.route("POST", path, handler);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        logger.info(`[webhook] Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    const origin = req.headers.origin || "*";
    const allowedOrigin = this.corsOrigins.includes("*") ? "*" : (this.corsOrigins.includes(origin) ? origin : "");
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (this.authToken && !this.checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const method = req.method?.toUpperCase() || "GET";
    const handler = this.routes.get(method)?.get(url.pathname);

    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const body = await readBody(req);

    try {
      await handler(req, res, body);
    } catch (err) {
      logger.error(`[webhook] Handler error: ${method} ${url.pathname}`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  }

  private checkAuth(req: IncomingMessage): boolean {
    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const tokenParam = url.searchParams.get("token");
    if (tokenParam === this.authToken) return true;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ") && authHeader.slice(7) === this.authToken) return true;

    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}
