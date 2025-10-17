import { createMCPServer } from "./mcp/index";

let cachedServer: ReturnType<typeof createMCPServer> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __MCP_SERVER__: ReturnType<typeof createMCPServer> | undefined;
}

async function getServer() {
  if (!cachedServer) {
    cachedServer = globalThis.__MCP_SERVER__ ?? (globalThis.__MCP_SERVER__ = createMCPServer());
  }
  return cachedServer;
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    return {
      error,
      isError: true
    } as const;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/mcp" && request.method === "POST") {
      const bodyResult = await parseJson(request);
      if ((bodyResult as { isError?: boolean }).isError) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const server = await getServer();
      const sessionId = request.headers.get("mcp-session-id") ?? undefined;
      const result = await server.handle(bodyResult, sessionId);

      const headers = new Headers();
      if (result.body !== undefined) {
        headers.set("content-type", "application/json");
      }
      if (result.sessionId) {
        headers.set("mcp-session-id", result.sessionId);
      }

      const responseBody = result.body !== undefined ? JSON.stringify(result.body) : null;
      return new Response(responseBody, {
        status: result.status,
        headers
      });
    }

    return new Response("Not found", { status: 404 });
  }
};
