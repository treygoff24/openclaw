import { describe, expect, it } from "vitest";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("openclaw tool discovery tools", () => {
  it("includes list_tools and list_tool in the tool list", () => {
    const tools = createOpenClawTools({
      disableMessageTool: true,
      sandboxed: false,
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list_tools");
    expect(names).toContain("list_tool");
  });

  it("list_tools can introspect a tool by name", async () => {
    const tools = createOpenClawTools({
      disableMessageTool: true,
      sandboxed: false,
    });
    const listToolsTool = tools.find((tool) => tool.name === "list_tools");

    expect(listToolsTool).toBeDefined();
    const result = await listToolsTool!.execute("call-detail", {
      tool: "list_tools",
    });
    const payload = (result.details ?? {}) as {
      name?: string;
      description?: string;
    };

    expect(payload.name).toBe("list_tools");
    expect(payload.description).toContain("Discover available tools");
  });
});
