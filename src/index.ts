import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getWidgetHtml } from './mcp/resources/widget.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { oauthService } from './services/oauth-service.js';
import { normalizeIdeaTool, handleNormalizeIdea } from './mcp/tools/normalizeIdea.js';
import { checkAuthTool, handleCheckAuth } from './mcp/tools/checkAuth.js';
import { listDestinationsTool, handleListDestinations } from './mcp/tools/listDestinations.js';
import { createTicketTool, handleCreateTicket } from './mcp/tools/createTicket.js';
import { connectDestinationTool, handleConnectDestination } from './mcp/tools/connectDestination.js';
import { proxyTools, PROXY_TOOL_NAMES, handleProxyTool } from './mcp/tools/proxyTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;

const getServerUrl = () => {
  return process.env.MCP_SERVER_URL || 'https://idealift-chatgpt.azurewebsites.net';
};

// ============================================
// MCP Server Setup (SSE-based)
// ============================================

const mcpServer = new Server(
  {
    name: 'idealift-chatgpt',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Store active transports, session context, and keep-alive intervals
const activeTransports = new Map<string, SSEServerTransport>();
const sessionContext = new Map<string, { connectedAt: string; lastPing: string }>();
const keepAliveIntervals = new Map<string, NodeJS.Timeout>();

// Keep-alive configuration
const KEEPALIVE_INTERVAL_MS = 15000; // 15 seconds - aggressive to prevent Azure/nginx timeouts

// Tool definitions for ListTools
const tools = [
  normalizeIdeaTool,
  checkAuthTool,
  listDestinationsTool,
  createTicketTool,
  connectDestinationTool,
  ...proxyTools,
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

// Register ListTools handler
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log('[MCP] Listing tools');
  return { tools };
});

// Register ListResources handler
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  console.log('[MCP] Listing resources');
  return { resources };
});

// Register ReadResource handler
mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  console.log('[MCP] Reading resource:', uri);

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

// Register CallTool handler
mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const toolName = request.params.name;
  const args = request.params.arguments as Record<string, unknown>;
  console.log(`[MCP] Tool invoked: ${toolName}`, { args });

  // Extract ChatGPT subject ID once for all tools
  const meta = request.params._meta as Record<string, unknown> | undefined;
  const chatgptSubjectId = meta?.['openai/subject'] as string | undefined;

  // Bootstrap subject→token link on first tool call after OAuth
  if (chatgptSubjectId) {
    await oauthService.linkSubjectToRecentToken(chatgptSubjectId);
  }

  try {
    switch (toolName) {
      case 'normalize_idea': {
        const result = await handleNormalizeIdea(args);
        console.log('[MCP] normalize_idea result:', {
          hasStructuredContent: !!result.structuredContent,
          title: result.structuredContent?.title,
          contentLength: result.content?.length,
        });
        return {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        };
      }

      case 'check_auth': {
        console.log('[MCP] check_auth called with chatgptSubjectId:', chatgptSubjectId);
        const result = await handleCheckAuth(chatgptSubjectId);
        console.log('[MCP] check_auth result:', {
          authenticated: result.structuredContent?.authenticated,
          content: result.content,
        });
        return {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        };
      }

      case 'list_destinations': {
        console.log('[MCP] list_destinations called with chatgptSubjectId:', chatgptSubjectId);
        const result = await handleListDestinations(chatgptSubjectId);
        console.log('[MCP] list_destinations result:', {
          authenticated: result.structuredContent?.authenticated,
          destinationCount: result.structuredContent?.destinations?.length,
          content: result.content,
        });
        return {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        };
      }

      case 'create_ticket': {
        console.log('[MCP] create_ticket called with chatgptSubjectId:', chatgptSubjectId);
        const result = await handleCreateTicket(args, chatgptSubjectId);
        console.log('[MCP] create_ticket result:', {
          success: result.structuredContent?.success,
          ticketUrl: result.structuredContent?.ticketUrl,
          error: result.structuredContent?.error,
          content: result.content,
        });
        return {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        };
      }

      case 'connect_destination': {
        console.log('[MCP] connect_destination called:', { destination: args.destination, chatgptSubjectId });
        const result = await handleConnectDestination(args, chatgptSubjectId);
        console.log('[MCP] connect_destination result:', {
          destination: result.structuredContent?.destination,
          hasConnectUrl: !!result.structuredContent?.connectUrl,
        });
        return {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        };
      }

      default: {
        // Check if this is a proxied Claude MCP tool
        if (PROXY_TOOL_NAMES.has(toolName)) {
          if (!chatgptSubjectId) {
            return {
              content: [{ type: 'text', text: 'Error: This tool requires authentication. Please use check_auth first to connect your IdeaLift account.' }],
              isError: true,
            };
          }
          console.log(`[MCP] Proxying tool ${toolName} for subject ${chatgptSubjectId}`);
          return await handleProxyTool(toolName, args, chatgptSubjectId);
        }

        return {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
      }
    }
  } catch (error) {
    console.error(`[MCP] Tool error: ${toolName}`, error);
    return {
      content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

// ============================================
// Express App (OAuth, API, and static files)
// ============================================

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Key'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve widget static files
const widgetPath = path.join(__dirname, '..', 'widget');
app.use('/widget', express.static(widgetPath));

// Widget route (serve index.html for all widget paths)
app.get('/widget/*', (req, res) => {
  res.sendFile(path.join(widgetPath, 'index.html'));
});

// Health check
app.get('/', async (req, res) => {
  res.json({
    status: 'ok',
    service: 'idealift-chatgpt-mcp',
    transport: 'sse',
    oauth: await oauthService.getStats(),
    activeSessions: sessionContext.size,
    keepAliveInterval: KEEPALIVE_INTERVAL_MS,
  });
});

app.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    oauth: await oauthService.getStats(),
    activeSessions: sessionContext.size,
    uptime: process.uptime(),
  });
});

// Connection status endpoint - ChatGPT can check if tools are available
app.get('/mcp/status', (req, res) => {
  // Get session ID from query or header (same as POST messages)
  const sessionId = req.query.sessionId as string ||
                    req.headers['mcp-session-id'] as string;

  if (sessionId && activeTransports.has(sessionId)) {
    const ctx = sessionContext.get(sessionId);
    res.json({
      connected: true,
      sessionId,
      connectedAt: ctx?.connectedAt,
      lastPing: ctx?.lastPing,
      keepAliveInterval: KEEPALIVE_INTERVAL_MS,
      tools: tools.map(t => t.name),
    });
  } else if (sessionId) {
    // Session was provided but not found - connection dropped
    res.json({
      connected: false,
      sessionId,
      error: 'Session expired or connection dropped. Re-establish connection at GET /mcp',
      reconnectUrl: '/mcp',
    });
  } else {
    // No session - show general status
    res.json({
      connected: false,
      activeSessions: sessionContext.size,
      message: 'Establish SSE connection at GET /mcp to use tools',
      tools: tools.map(t => t.name),
    });
  }
});

// List all active sessions (for debugging)
app.get('/mcp/sessions', (req, res) => {
  const sessions = Array.from(sessionContext.entries()).map(([id, ctx]) => ({
    sessionId: id,
    ...ctx,
    hasTransport: activeTransports.has(id),
    hasKeepAlive: keepAliveIntervals.has(id),
  }));

  res.json({
    count: sessions.length,
    sessions,
  });
});

// OpenAI Domain Verification (Apps Challenge)
app.get('/.well-known/openai-apps-challenge', (req, res) => {
  const token = process.env.OPENAI_DOMAIN_VERIFICATION_TOKEN;
  if (!token) {
    return res.status(404).send('Verification token not configured');
  }
  res.set('Content-Type', 'text/plain');
  res.send(token);
});

// Logo endpoint (SVG for simplicity)
app.get('/logo.png', (req, res) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="80" fill="#1a1a2e"/>
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#00d4ff"/>
          <stop offset="100%" style="stop-color:#0099cc"/>
        </linearGradient>
      </defs>
      <text x="256" y="300" font-family="Arial, sans-serif" font-size="200" font-weight="bold" fill="url(#grad)" text-anchor="middle">IL</text>
    </svg>
  `;
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// ============================================
// ChatGPT Plugin Manifest & OpenAPI Spec
// ============================================

app.get('/.well-known/ai-plugin.json', (req, res) => {
  const serverUrl = getServerUrl();
  res.json({
    schema_version: 'v1',
    name_for_human: 'IdeaLift',
    name_for_model: 'idealift',
    description_for_human: 'Turn ideas into structured tickets. Normalize raw thoughts and create issues in GitHub, Jira, or Linear.',
    description_for_model: 'IdeaLift helps users transform unstructured ideas into well-formatted tickets. Use normalize_idea to structure raw text into a proper feature request, bug report, or task. Use list_destinations to see connected project management tools. Use create_ticket to create an issue in the user\'s chosen destination. Always normalize ideas before creating tickets.',
    auth: {
      type: 'oauth',
      client_url: `${serverUrl}/oauth/authorize`,
      scope: 'read write',
      authorization_url: `${serverUrl}/oauth/token`,
      authorization_content_type: 'application/x-www-form-urlencoded',
      verification_tokens: {
        openai: process.env.OPENAI_VERIFICATION_TOKEN || ''
      }
    },
    api: {
      type: 'openapi',
      url: `${serverUrl}/openapi.json`
    },
    logo_url: `${serverUrl}/logo.png`,
    contact_email: 'support@startvest.ai',
    legal_info_url: 'https://idealift.app/legal'
  });
});

app.get('/openapi.json', (req, res) => {
  const serverUrl = getServerUrl();
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'IdeaLift API',
      version: '1.0.0',
      description: 'Transform ideas into structured tickets for GitHub, Jira, and Linear'
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/api/normalize': {
        post: {
          operationId: 'normalizeIdea',
          summary: 'Normalize a raw idea into a structured format',
          description: 'Takes unstructured text and transforms it into a well-formatted idea with title, description, type, and priority.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['text'],
                  properties: {
                    text: { type: 'string', description: 'The raw idea text to normalize' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Normalized idea',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      description: { type: 'string' },
                      type: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task'] },
                      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/destinations': {
        get: {
          operationId: 'listDestinations',
          summary: 'List available ticket destinations',
          description: 'Returns all connected project management tools where tickets can be created.',
          responses: {
            '200': {
              description: 'List of destinations',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      destinations: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            type: { type: 'string', enum: ['github', 'jira', 'linear'] },
                            project: { type: 'string' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/tickets': {
        post: {
          operationId: 'createTicket',
          summary: 'Create a ticket in a destination',
          description: 'Creates an issue/ticket in the specified destination.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['destination_id', 'title'],
                  properties: {
                    destination_id: { type: 'string', description: 'The ID of the destination' },
                    title: { type: 'string', description: 'Ticket title' },
                    description: { type: 'string', description: 'Ticket description/body' },
                    type: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task'] },
                    priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Created ticket',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      ticket_url: { type: 'string' },
                      ticket_id: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
});

// ============================================
// REST API Endpoints (for ChatGPT Plugin compatibility)
// ============================================

app.post('/api/normalize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await handleNormalizeIdea({ text });
    res.json(result.structuredContent);
  } catch (error) {
    console.error('Normalize error:', error);
    res.status(500).json({ error: 'Failed to normalize idea' });
  }
});

app.get('/api/destinations', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.replace('Bearer ', '');

    const result = await handleListDestinations(accessToken);
    res.json(result.structuredContent);
  } catch (error) {
    console.error('Destinations error:', error);
    res.status(500).json({ error: 'Failed to list destinations' });
  }
});

app.post('/api/tickets', async (req, res) => {
  try {
    const { destination_id, title, description, type, priority } = req.body;

    if (!destination_id || !title) {
      return res.status(400).json({ error: 'destination_id and title are required' });
    }

    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.replace('Bearer ', '');

    const args = {
      destination: destination_id,
      idea: {
        title,
        summary: description || '',
        category: type || 'feature',
        priority: priority || 'medium',
      },
    };

    const result = await handleCreateTicket(args, accessToken);
    res.json(result.structuredContent);
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// ============================================
// OAuth 2.0 Discovery Endpoints (RFC 8414)
// ============================================

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const serverUrl = getServerUrl();
  res.json({
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    revocation_endpoint: `${serverUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write'],
    code_challenge_methods_supported: ['S256'],
  });
});

app.get('/.well-known/openid-configuration', (req, res) => {
  const serverUrl = getServerUrl();
  res.json({
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    revocation_endpoint: `${serverUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write'],
  });
});

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const serverUrl = getServerUrl();
  res.json({
    resource: serverUrl,
    authorization_servers: [serverUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  });
});

// ============================================
// OAuth 2.0 Endpoints
// ============================================

app.get('/oauth/authorize', async (req, res) => {
  const { client_id, redirect_uri, state, scope, response_type } = req.query;

  const result = await oauthService.authorize({
    clientId: client_id as string,
    redirectUri: redirect_uri as string,
    state: state as string,
    scope: scope as string,
    responseType: response_type as string,
  });

  if (result.error) {
    const errorUrl = new URL(redirect_uri as string);
    errorUrl.searchParams.set('error', result.error);
    errorUrl.searchParams.set('error_description', result.errorDescription || '');
    if (state) errorUrl.searchParams.set('state', state as string);
    return res.redirect(errorUrl.toString());
  }

  res.redirect(result.redirectUrl!);
});

app.post('/oauth/token', async (req, res) => {
  const body = req.body;

  let clientId = body.client_id;
  let clientSecret = body.client_secret;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString();
    const [id, secret] = decoded.split(':');
    clientId = clientId || id;
    clientSecret = clientSecret || secret;
  }

  console.log('[OAuth] Token request received', {
    clientId,
    grantType: body.grant_type,
    hasCode: !!body.code,
  });

  const result = await oauthService.token({
    code: body.code,
    clientId,
    clientSecret,
    redirectUri: body.redirect_uri,
    grantType: body.grant_type,
    refreshToken: body.refresh_token,
  });

  console.log('[OAuth] Token result', {
    clientId,
    hasError: !!result.error,
    hasAccessToken: !!result.access_token,
  });

  if (result.error) {
    return res.status(400).json({
      error: result.error,
      error_description: result.error_description,
    });
  }

  res.json(result);
});

app.post('/oauth/revoke', async (req, res) => {
  const { token } = req.body;
  if (token) await oauthService.revokeToken(token);
  res.status(200).json({ success: true });
});

app.post('/oauth/complete', async (req, res) => {
  const { oauth_code, user_id, workspace_id } = req.body;

  const apiKey = req.headers['x-internal-key'];
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await oauthService.completeAuthorization(oauth_code, user_id, workspace_id);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ redirectUrl: result.redirectUrl });
});

app.options('/oauth/*', (req, res) => {
  res.status(204).end();
});

// ============================================
// HTTP Server (Handles MCP SSE + Express)
// ============================================

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Key');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ============================================
  // MCP SSE Endpoint - Establish Connection
  // ============================================
  if (url.pathname === '/mcp' && req.method === 'GET') {
    console.log('[MCP] New SSE connection request', {
      accept: req.headers.accept,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      origin: req.headers.origin,
    });

    const transport = new SSEServerTransport('/mcp/messages', res);

    // Start keep-alive pings to prevent connection timeout
    // SSE comments (lines starting with :) are used as keep-alive signals
    const pingInterval = setInterval(() => {
      try {
        if (!res.writableEnded && !res.destroyed) {
          res.write(':ping\n\n');
          // Update last ping time
          const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
          if (sessionId) {
            const ctx = sessionContext.get(sessionId);
            if (ctx) {
              ctx.lastPing = new Date().toISOString();
            }
          }
        } else {
          // Connection is dead, clean up
          clearInterval(pingInterval);
        }
      } catch (e) {
        console.log('[MCP] Keep-alive ping failed, connection likely closed:', e);
        clearInterval(pingInterval);
      }
    }, KEEPALIVE_INTERVAL_MS);

    transport.onclose = () => {
      const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
      if (sessionId) {
        // Clear keep-alive interval
        const interval = keepAliveIntervals.get(sessionId);
        if (interval) {
          clearInterval(interval);
          keepAliveIntervals.delete(sessionId);
        }
        activeTransports.delete(sessionId);
        sessionContext.delete(sessionId);
        console.log(`[MCP] SSE connection closed: ${sessionId}`);
      }
    };

    // Handle connection close from client side
    res.on('close', () => {
      const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
      console.log(`[MCP] Client disconnected: ${sessionId}`);
      clearInterval(pingInterval);
      if (sessionId) {
        keepAliveIntervals.delete(sessionId);
        activeTransports.delete(sessionId);
        sessionContext.delete(sessionId);
      }
    });

    await mcpServer.connect(transport);

    const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
    activeTransports.set(sessionId, transport);
    sessionContext.set(sessionId, { connectedAt: new Date().toISOString(), lastPing: new Date().toISOString() });
    keepAliveIntervals.set(sessionId, pingInterval);

    console.log(`[MCP] SSE connection established: ${sessionId}, keep-alive enabled (${KEEPALIVE_INTERVAL_MS}ms)`);
    return;
  }

  // ============================================
  // MCP POST Messages - Route through Transport
  // Handles both POST /mcp and POST /mcp/messages
  // Supports both old (sessionId query) and new (Mcp-Session-Id header) protocols
  // ============================================
  if ((url.pathname === '/mcp' || url.pathname.startsWith('/mcp/messages')) && req.method === 'POST') {
    // Try sessionId from query param (old protocol) or Mcp-Session-Id header (new protocol)
    const sessionId = url.searchParams.get('sessionId') ||
                      (req.headers['mcp-session-id'] as string | undefined);
    console.log(`[MCP] POST ${url.pathname} received`, {
      sessionId,
      hasQuerySession: !!url.searchParams.get('sessionId'),
      hasHeaderSession: !!req.headers['mcp-session-id'],
      headers: Object.keys(req.headers)
    });

    if (sessionId && activeTransports.has(sessionId)) {
      const transport = activeTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    console.warn(`[MCP] No active transport found for session: ${sessionId}`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No active SSE connection. Please establish GET /mcp first.' }));
    return;
  }

  // ============================================
  // Everything Else -> Express
  // ============================================
  app(req, res);
});

httpServer.listen(PORT, () => {
  console.log(`IdeaLift ChatGPT MCP Server running on port ${PORT}`);
  console.log(`MCP SSE endpoint: http://localhost:${PORT}/mcp`);
  console.log(`OAuth authorize: http://localhost:${PORT}/oauth/authorize`);
  console.log(`OAuth token: http://localhost:${PORT}/oauth/token`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
