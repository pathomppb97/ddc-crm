import http from "node:http";
import type { SqlExecutor } from "../../../packages/shared-services/src/index";
import { createRemoteMcpApp } from "./mcpServer";
import type { McpOAuthConfig } from "./oauthAuth";

export interface NodeMcpServerOptions {
  db: SqlExecutor;
  oauth: McpOAuthConfig;
  port?: number;
  host?: string;
  allowedOriginHostnames?: string[];
}

/**
 * Independently deployable Node.js HTTP server exposing:
 * - POST/GET/DELETE /mcp (Streamable HTTP)
 * - GET /.well-known/oauth-protected-resource (RFC 9728)
 * - GET /.well-known/oauth-protected-resource/mcp (RFC 9728 path-aware)
 * - GET /.well-known/oauth-authorization-server (RFC 8414)
 * - GET /health
 *
 * Terminate TLS (HTTPS) at the production reverse proxy / ingress.
 */
export async function startNodeMcpServer(options: NodeMcpServerOptions) {
  const app = createRemoteMcpApp({
    db: options.db,
    oauth: options.oauth,
    allowedOriginHostnames: options.allowedOriginHostnames,
  });

  await app.syncRegistry();

  const port = options.port ?? Number(process.env.MCP_PORT ?? 8787);
  const host = options.host ?? process.env.MCP_HOST ?? "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host ?? `${host}:${port}`}`;
      const url = new URL(req.url ?? "/", origin);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyBuffer = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, String(item));
        } else if (v !== undefined) {
          headers.set(k, String(v));
        }
      }

      const webReq = new Request(url, {
        method: req.method ?? "GET",
        headers,
        body:
          req.method !== "GET" && req.method !== "HEAD" && bodyBuffer
            ? new Uint8Array(bodyBuffer)
            : undefined,
      });

      const webRes = await app.fetch(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const out = Buffer.from(await webRes.arrayBuffer());
      res.end(out);
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR" } }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  return {
    server,
    app,
    url: `http://${host}:${port}/mcp`,
    close: async () => {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
