import { Request, Response } from 'express';
import { normalizeIdeaTool, handleNormalizeIdea } from './tools/normalizeIdea.js';
import { checkAuthTool, handleCheckAuth } from './tools/checkAuth.js';
import { listDestinationsTool, handleListDestinations } from './tools/listDestinations.js';
import { createTicketTool, handleCreateTicket } from './tools/createTicket.js';
import { getWidgetHtml } from './resources/widget.js';

// MCP Server URL for OAuth challenges
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://idealift-chatgpt.azurewebsites.net';

// Tools that require authentication
const PROTECTED_TOOLS = ['list_destinations', 'create_ticket'];

// Tool definitions
const tools = [
  normalizeIdeaTool,
  checkAuthTool,
  listDestinationsTool,
  createTicketTool,
];

// Resource definitions
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

export async function mcpHandler(req: Request, res: Response) {
  const { method } = req;
  const body = req.body || {};

  // Extract access token from Authorization header
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  try {
    // Handle JSON-RPC requests
    if (body.jsonrpc === '2.0') {
      const { id, method: rpcMethod, params } = body;

      let result: unknown;

      switch (rpcMethod) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: 'idealift-chatgpt',
              version: '1.0.0',
            },
          };
          break;

        case 'tools/list':
          result = { tools };
          break;

        case 'tools/call':
          result = await handleToolCall(params.name, params.arguments, params._meta, accessToken);
          break;

        case 'resources/list':
          result = { resources };
          break;

        case 'resources/read':
          result = await handleResourceRead(params.uri);
          break;

        default:
          return res.status(400).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${rpcMethod}` },
          });
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        result,
      });
    }

    // Fallback for non-JSON-RPC requests
    res.status(400).json({ error: 'Invalid request format' });
  } catch (error) {
    console.error('MCP handler error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message: 'Internal error' },
    });
  }
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
  accessToken?: string
): Promise<unknown> {
  // Extract ChatGPT subject ID from meta
  const chatgptSubjectId = meta?.['openai/subject'] as string | undefined;

  // Check if this is a protected tool and user is not authenticated
  if (PROTECTED_TOOLS.includes(name) && !accessToken && !chatgptSubjectId) {
    // Return WWW-Authenticate challenge for protected tools
    return {
      content: [
        {
          type: 'text',
          text: 'Authentication required. Please connect your IdeaLift account.',
        },
      ],
      _meta: {
        'mcp/www_authenticate': `Bearer resource="${MCP_SERVER_URL}/.well-known/oauth-protected-resource"`,
      },
      isError: true,
    };
  }

  switch (name) {
    case 'normalize_idea':
      return handleNormalizeIdea(args, chatgptSubjectId);

    case 'check_auth':
      return handleCheckAuth(chatgptSubjectId);

    case 'list_destinations':
      return handleListDestinations(accessToken || chatgptSubjectId);

    case 'create_ticket':
      return handleCreateTicket(args, accessToken || chatgptSubjectId);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleResourceRead(uri: string): Promise<unknown> {
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
}
