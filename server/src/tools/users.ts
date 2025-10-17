import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const UsersResponseSchema = z.object({
  rows: z.array(z.object({ id: z.number(), name: z.string() }))
});

type UsersResponse = z.infer<typeof UsersResponseSchema>;

export async function listUsersTool(): Promise<CallToolResult> {
  const data: UsersResponse = {
    rows: [
      { id: 1, name: "Ada Lovelace" },
      { id: 2, name: "Alan Turing" },
      { id: 3, name: "Grace Hopper" }
    ]
  };

  const validated = UsersResponseSchema.parse(data);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(validated)
      }
    ],
    structuredContent: validated
  };
}
