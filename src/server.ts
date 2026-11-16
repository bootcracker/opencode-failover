import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { FREE_MODELS } from "./models";
import { runChatCompletionsFailover, type ChatCompletionBody } from "./failover";

export interface StartServerOptions {
  port: number;
  host: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function sendFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const stream = Readable.fromWeb(response.body as never) as Readable;
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  }
  const text = await response.text();
  res.writeHead(response.status, { "content-type": contentType || "application/json" });
  res.end(text);
}

export function startServer(options: StartServerOptions): { server: Server } {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/health/")) {
        return sendJson(res, 200, { status: "ok", models: FREE_MODELS.map((m) => m.id) });
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(res, 200, {
          object: "list",
          data: FREE_MODELS.map((m) => ({ id: m.id, object: "model", owned_by: "opencode" })),
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = (await readJson(req)) as ChatCompletionBody;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 600_000);
        try {
          const result = await runChatCompletionsFailover({
            apiKey: process.env.OPENCODE_API_KEY ?? "",
            baseUrl: (process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/inference/openai/v1").replace(/\/+$/, ""),
            body,
            signal: controller.signal,
          });

          if (result.ok && result.response) {
            return await sendFetchResponse(res, result.response);
          }

          const status = result.ok === false && "status" in result ? result.status : 500;
          const errorBody = result.ok === false && "body" in result ? result.body : { error: { message: "Unexpected failover result" } };
          return sendJson(res, status, errorBody);
        } finally {
          clearTimeout(timer);
        }
      }

      return sendJson(res, 404, { error: { message: `No route for ${req.method ?? ""} ${url.pathname}` } });
    } catch (error) {
      return sendJson(res, 500, { error: { message: `Internal error: ${String(error)}` } });
    }
  });

  return { server };
}
