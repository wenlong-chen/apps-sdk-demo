import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isJSONRPCNotification, isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import widgetsManifest from "../widgets.gen.json";
import type { WidgetManifestFile } from "../types";
import { listUsersTool } from "../tools/users";

interface SessionState {
  id: string;
  server: McpServer;
  transport: MemoryTransport;
}

interface HandleResult {
  status: number;
  body?: unknown;
  sessionId?: string;
}

class MemoryTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;
  public sessionId?: string;

  private started = false;
  private closed = false;
  private outgoing: JSONRPCMessage[] = [];
  private waiters: ((messages: JSONRPCMessage[]) => void)[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Transport already started");
    }
    this.started = true;
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this.outgoing.push(message);
    if (this.waiters.length) {
      const payload = this.drain();
      for (const resolve of this.waiters) {
        resolve(payload);
      }
      this.waiters = [];
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.();
  }

  dispatch(message: JSONRPCMessage, expectResponse: boolean): Promise<JSONRPCMessage[]> {
    if (!this.started) {
      throw new Error("Transport not started");
    }
    this.onmessage?.(message);
    if (!expectResponse) {
      return Promise.resolve([]);
    }
    return this.flush();
  }

  private drain(): JSONRPCMessage[] {
    const copy = [...this.outgoing];
    this.outgoing = [];
    return copy;
  }

  private flush(): Promise<JSONRPCMessage[]> {
    if (this.outgoing.length) {
      return Promise.resolve(this.drain());
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

const sessions = new Map<string, SessionState>();

async function createServerInstance(sessionId: string, manifest: WidgetManifestFile): Promise<SessionState> {
  const server = new McpServer({
    name: "cloudflare-mcp-demo",
    version: "0.1.0"
  });

  const transport = new MemoryTransport(sessionId);

  const widget = manifest.widgets[0];

  server.registerTool(
    "list-users",
    {
      title: "List demo users",
      description: "Returns a static list of demo users.",
      outputSchema: {
        rows: z.array(
          z.object({
            id: z.number(),
            name: z.string()
          })
        )
      },
      annotations: widget
        ? {
            "demo:widget": {
              name: widget.name,
              description: widget.description,
              fragment: widget.fragment
            }
          }
        : undefined
    },
    async () => {
      const result = await listUsersTool();
      return {
        content: result.content,
        structuredContent: result.structuredContent
      };
    }
  );

  try {
    await server.connect(transport);
  } catch (error) {
    transport.onerror?.(error instanceof Error ? error : new Error(String(error)));
  }

  transport.onclose = () => {
    sessions.delete(sessionId);
  };

  return { id: sessionId, server, transport };
}

export function createMCPServer() {
  const manifest = widgetsManifest as WidgetManifestFile;

  async function ensureSession(sessionId?: string, request?: JSONRPCMessage): Promise<SessionState | undefined> {
    if (sessionId) {
      return sessions.get(sessionId);
    }

    if (!request || !isJSONRPCRequest(request) || request.method !== "initialize") {
      return undefined;
    }

    const id = globalThis.crypto.randomUUID();
    const session = await createServerInstance(id, manifest);
    sessions.set(id, session);
    return session;
  }

  function findResponseMessage(messages: JSONRPCMessage[], request?: JSONRPCMessage): JSONRPCMessage | undefined {
    if (!messages.length) {
      return undefined;
    }

    if (!request || !("id" in request)) {
      return messages[messages.length - 1];
    }

    const id = (request as { id?: string | number | null }).id;
    return messages.find((message) => "id" in message && (message as { id?: string | number | null }).id === id) ??
      messages[messages.length - 1];
  }

  async function handle(body: unknown, providedSessionId?: string): Promise<HandleResult> {
    if (Array.isArray(body)) {
      return {
        status: 400,
        body: {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Batch requests are not supported in this demo." }
        }
      };
    }

    if (typeof body !== "object" || body === null) {
      return {
        status: 400,
        body: {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request." }
        }
      };
    }

    const message = body as JSONRPCMessage;

    const session = await ensureSession(providedSessionId, message);

    if (!session) {
      return {
        status: 400,
        body: {
          jsonrpc: "2.0",
          id: "id" in message ? (message as { id: string | number | null }).id : null,
          error: { code: -32000, message: "Unknown MCP session." }
        }
      };
    }

    const isNotification = isJSONRPCNotification(message);
    const responseMessages = await session.transport.dispatch(message, !isNotification);

    if (isNotification) {
      return {
        status: 204,
        sessionId: session.id
      };
    }

    const responseMessage = findResponseMessage(responseMessages, message);

    if (!responseMessage) {
      return {
        status: 202,
        sessionId: session.id
      };
    }

    return {
      status: 200,
      body: responseMessage,
      sessionId: session.id
    };
  }

  return { handle };
}
