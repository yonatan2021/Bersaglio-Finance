import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoreTools } from "./core";
import { registerWriteTools } from "./write";
import { registerAdminTools } from "./admin";

export const TOOL_GROUPS = ["core", "write", "admin"] as const;
export type ToolGroup = typeof TOOL_GROUPS[number];

export function createMcpServer(groups?: ToolGroup[]) {
    const server = new McpServer({
        name: "nudlers",
        version: "1.0.0",
    });

    // If no groups are specified (or empty), load all groups to maintain backwards compatibility
    const activeGroups = groups && groups.length > 0 ? groups : TOOL_GROUPS;

    if (activeGroups.includes("core")) {
        registerCoreTools(server);
    }
    if (activeGroups.includes("write")) {
        registerWriteTools(server);
    }
    if (activeGroups.includes("admin")) {
        registerAdminTools(server);
    }

    return server;
}
