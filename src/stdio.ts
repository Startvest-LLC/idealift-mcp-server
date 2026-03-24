/**
 * Stdio transport entry point for MCP inspection (Glama, mcp-proxy, etc.)
 * 
 * Starts the MCP server with StdioServerTransport instead of SSE/HTTP.
 * This allows tools like Glama to inspect available tools and resources
 * without needing a running HTTP server or database connection.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getWidgetHtml } from './mcp/resources/widget.js';
import { normalizeIdeaTool, handleNormalizeIdea } from './mcp/tools/normalizeIdea.js';
import { checkAuthTool, handleCheckAuth } from './mcp/tools/checkAuth.js';
import { listDestinationsTool, handleListDestinations } from './mcp/tools/listDestinations.js';
import { createTicketTool, handleCreateTicket } from './mcp/tools/createTicket.js';
import { connectDestinationTool, handleConnectDestination } from './mcp/tools/connectDestination.js';
import { proxyTools, PROXY_TOOL_NAMES, handleProxyTool } from './mcp/tools/proxyTools.js';

const mcpServer = new Server(
  {
    name: 'idealift-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const tools = [
  normalizeIdeaTool,
  checkAuthTool,
  listDestinationsTool,
  createTicketTool,
  connectDestinationTool,
  ...proxyTools,
];

const resources = [
  {
    uri: 'resource://widget/preview',
    name: 'IdeaLift Preview Widget',
    mimeType: 'text/html+skybridge',
    description: 'Widget for displaying normalized idea preview',
  },
  {
    uri: 'resource://widget/success',
    name: 'IdeaLift Success Widget',
    mimeType: 'text/html+skybridge',
    description: 'Widget for displaying ticket creation success',
  },
];

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources };
});

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === 'resource://widget/preview' || uri === 'resource://widget/success') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/html+skybridge',
          text: getWidgetHtml(),
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments as Record<string, unknown>;

  try {
    switch (toolName) {
      case 'normalize_idea': {
        const result = await handleNormalizeIdea(args);
        return { content: [{ type: 'text', text: result.content }], isError: false };
      }
      case 'check_auth': {
        const result = await handleCheckAuth(undefined);
        return { content: [{ type: 'text', text: result.content }], isError: false };
      }
      case 'list_destinations': {
        const result = await handleListDestinations(undefined);
        return { content: [{ type: 'text', text: result.content }], isError: false };
      }
      case 'create_ticket': {
        const result = await handleCreateTicket(args, undefined);
        return { content: [{ type: 'text', text: result.content }], isError: false };
      }
      case 'connect_destination': {
        const result = await handleConnectDestination(args, undefined);
        return { content: [{ type: 'text', text: result.content }], isError: false };
      }
      default: {
        if (PROXY_TOOL_NAMES.has(toolName)) {
          return {
            content: [{ type: 'text', text: 'This tool requires authentication. Connect your IdeaLift account first.' }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
      }
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[MCP] IdeaLift stdio transport running');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
