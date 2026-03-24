/**
 * Stdio transport entry point for MCP inspection (Glama, mcp-proxy, etc.)
 *
 * Completely standalone. No database, no HTTP, no heavy dependencies.
 * Only registers tool/resource metadata so inspectors can discover
 * capabilities via tools/list and resources/list.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const mcpServer = new Server(
  { name: 'idealift-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

const tools = [
  {
    name: 'normalize_idea',
    description: 'Normalize a raw product idea into a structured format with title, summary, type, priority, and signal analysis.',
    inputSchema: { type: 'object' as const, properties: { text: { type: 'string', description: 'The raw idea text to normalize (1-10000 chars)' }, context: { type: 'object', properties: { source: { type: 'string', enum: ['chatgpt'] } } } }, required: ['text'] },
  },
  {
    name: 'check_auth',
    description: 'Check if the user is authenticated with IdeaLift and return workspace details.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_destinations',
    description: 'List connected project management destinations (GitHub, Jira, Linear) where tickets can be created.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'create_ticket',
    description: 'Create a ticket in a connected destination (GitHub, Jira, or Linear) from a normalized idea.',
    inputSchema: { type: 'object' as const, properties: { destination: { type: 'string', enum: ['github', 'jira', 'linear'] }, idea: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, category: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task'] }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } }, required: ['title'] } }, required: ['destination'] },
  },
  {
    name: 'connect_destination',
    description: 'Get the OAuth URL to connect a new destination (GitHub, Jira, or Linear).',
    inputSchema: { type: 'object' as const, properties: { destination: { type: 'string', enum: ['github', 'jira', 'linear'] } }, required: ['destination'] },
  },
  {
    name: 'list_ideas',
    description: 'List ideas in the workspace with optional filters. Returns paginated results.',
    inputSchema: { type: 'object' as const, properties: { status: { type: 'string', enum: ['new', 'accepted', 'rejected', 'snoozed', 'expired'] }, source: { type: 'string' }, destination: { type: 'string' }, limit: { type: 'number', default: 20 }, offset: { type: 'number', default: 0 } }, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'get_idea',
    description: 'Get detailed information about a specific idea by ID.',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' } }, required: ['ideaId'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_idea',
    description: 'Create a new idea in the workspace. Checks plan limits before creating.',
    inputSchema: { type: 'object' as const, properties: { title: { type: 'string' }, summary: { type: 'string' }, source: { type: 'string', default: 'mcp' }, url: { type: 'string' }, authorName: { type: 'string' }, authorId: { type: 'string' } }, required: ['title'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'update_idea',
    description: 'Update an existing idea. Can update title, summary, status, RICE scores, etc.',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, status: { type: 'string' }, destination: { type: 'string' }, riceReach: { type: 'number' }, riceImpact: { type: 'number' }, riceConfidence: { type: 'number' }, riceEffort: { type: 'number' } }, required: ['ideaId'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'search_ideas',
    description: 'Search ideas by text query. Searches title and summary fields.',
    inputSchema: { type: 'object' as const, properties: { query: { type: 'string' }, status: { type: 'string' }, source: { type: 'string' }, limit: { type: 'number', default: 20 } }, required: ['query'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'query_ideas',
    description: 'Execute a natural language query about ideas. Examples: "Show me high-impact features", "Top 5 most requested features".',
    inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'list_signals',
    description: 'List signals (external feedback from Twitter, Reddit, support tickets, etc.) with optional filters.',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' }, source: { type: 'string' }, sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] }, category: { type: 'string', enum: ['feature_request', 'bug_report', 'praise', 'complaint', 'question', 'mention'] }, limit: { type: 'number', default: 20 }, offset: { type: 'number', default: 0 } }, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'get_signal_analytics',
    description: 'Get aggregated analytics about signals over a time period.',
    inputSchema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, groupBy: { type: 'string', enum: ['day', 'week', 'month', 'source', 'sentiment', 'category'], default: 'day' } }, required: ['startDate', 'endDate'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'attach_signal',
    description: 'Link a signal to an idea. Associates external feedback with a specific product idea.',
    inputSchema: { type: 'object' as const, properties: { signalId: { type: 'string' }, ideaId: { type: 'string' } }, required: ['signalId', 'ideaId'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'log_decision',
    description: 'Log a decision event for an idea. Creates an audit trail entry.',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' }, eventType: { type: 'string', enum: ['created', 'updated', 'accepted', 'rejected', 'snoozed', 'expired', 'reopened', 'merged', 'superseded', 'unmerged', 'ticket_created', 'ticket_closed', 'shipped', 'signal_recorded', 'surfaced', 'confidence_updated', 'category_changed', 'relationship_added', 'relationship_removed'] }, closureCategory: { type: 'string' }, reason: { type: 'string' }, confidenceScore: { type: 'number' } }, required: ['ideaId', 'eventType'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'get_decision_history',
    description: 'Get the complete decision history (audit trail) for an idea.',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' } }, required: ['ideaId'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_relationship',
    description: 'Create a relationship between two ideas. Types: related_to, alternative_to, superseded_by, merged_into, blocked_by, parent_of, derived_from.',
    inputSchema: { type: 'object' as const, properties: { sourceIdeaId: { type: 'string' }, targetIdeaId: { type: 'string' }, relationshipType: { type: 'string', enum: ['related_to', 'alternative_to', 'superseded_by', 'merged_into', 'blocked_by', 'parent_of', 'derived_from'] }, note: { type: 'string' } }, required: ['sourceIdeaId', 'targetIdeaId', 'relationshipType'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'list_relationships',
    description: 'Get all relationships for an idea (both as source and target).',
    inputSchema: { type: 'object' as const, properties: { ideaId: { type: 'string' } }, required: ['ideaId'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
];

const resources = [
  { uri: 'resource://widget/preview', name: 'IdeaLift Preview Widget', mimeType: 'text/html', description: 'Widget for displaying normalized idea preview' },
  { uri: 'resource://widget/success', name: 'IdeaLift Success Widget', mimeType: 'text/html', description: 'Widget for displaying ticket creation success' },
];

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return { contents: [{ uri: request.params.uri, mimeType: 'text/html', text: '<html><body><p>IdeaLift widget available in full server mode.</p></body></html>' }] };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  return { content: [{ type: 'text', text: `Tool "${request.params.name}" requires a running IdeaLift server. This is an inspection-only endpoint.` }], isError: true };
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
console.error('[MCP] IdeaLift stdio transport running (inspection mode)');
