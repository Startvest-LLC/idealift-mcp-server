/**
 * Proxy Tools — 13 Claude MCP tools available to ChatGPT users
 *
 * These tools are proxied through the main IdeaLift app's MCP handler,
 * so all business logic, auth, and workspace scoping happens there.
 * This file only defines the tool metadata and a generic proxy handler.
 *
 * IMPORTANT: Every tool MUST have `annotations` and `_meta` with
 * `openai/visibility: 'public'` or ChatGPT will disable it.
 */

import { idealiftClient } from '../../lib/idealift-client.js';

// =============================================================================
// Tool Definitions (matching Claude MCP exactly)
// =============================================================================

export const proxyTools = [
  // --- Ideas ---
  {
    name: 'list_ideas',
    description: 'List ideas in the workspace with optional filters. Returns paginated results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['new', 'accepted', 'rejected', 'snoozed', 'expired'],
          description: 'Filter by idea status',
        },
        source: {
          type: 'string',
          enum: ['discord', 'slack', 'teams', 'zapier', 'api', 'chrome', 'vscode', 'extension', 'sentry', 'fireflies', 'email', 'outlook', 'meeting', 'mcp'],
          description: 'Filter by source',
        },
        destination: {
          type: 'string',
          enum: ['github', 'linear', 'jira', 'azure-devops', 'zendesk'],
          description: 'Filter by destination',
        },
        limit: {
          type: 'number',
          description: 'Number of ideas to return (max 100)',
          default: 20,
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination',
          default: 0,
        },
      },
      required: [],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'get_idea',
    description: 'Get detailed information about a specific idea by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: {
          type: 'string',
          description: 'The unique ID of the idea',
        },
      },
      required: ['ideaId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'create_idea',
    description: 'Create a new idea in the workspace. Checks plan limits before creating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Title of the idea',
        },
        summary: {
          type: 'string',
          description: 'Detailed description of the idea',
        },
        source: {
          type: 'string',
          enum: ['discord', 'slack', 'teams', 'zapier', 'api', 'chrome', 'vscode', 'extension', 'sentry', 'fireflies', 'email', 'outlook', 'meeting', 'mcp'],
          description: 'Source of the idea',
          default: 'mcp',
        },
        url: {
          type: 'string',
          description: 'URL reference for the idea',
        },
        authorName: {
          type: 'string',
          description: 'Name of the person who submitted the idea',
        },
        authorId: {
          type: 'string',
          description: 'External ID of the author',
        },
      },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'update_idea',
    description: 'Update an existing idea. Can update title, summary, status, scores, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: {
          type: 'string',
          description: 'The unique ID of the idea to update',
        },
        title: { type: 'string', description: 'New title' },
        summary: { type: 'string', description: 'New summary' },
        status: {
          type: 'string',
          enum: ['new', 'accepted', 'rejected', 'snoozed', 'expired'],
          description: 'New status',
        },
        destination: {
          type: 'string',
          enum: ['github', 'linear', 'jira', 'azure-devops', 'zendesk'],
          description: 'New destination',
        },
        riceReach: { type: 'number', description: 'RICE reach score (0-10)' },
        riceImpact: { type: 'number', description: 'RICE impact score (0-3)' },
        riceConfidence: { type: 'number', description: 'RICE confidence (0-1)' },
        riceEffort: { type: 'number', description: 'RICE effort in person-months' },
      },
      required: ['ideaId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'search_ideas',
    description: 'Search ideas by text query. Searches title and summary fields.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query text' },
        status: {
          type: 'string',
          enum: ['new', 'accepted', 'rejected', 'snoozed', 'expired'],
          description: 'Filter by status',
        },
        source: { type: 'string', description: 'Filter by source' },
        limit: { type: 'number', description: 'Number of results to return', default: 20 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },

  // --- NLQ ---
  {
    name: 'query_ideas',
    description: `Execute a natural language query about ideas in the workspace.
Examples:
- "Show me high-impact features from enterprise customers"
- "What are the top 5 most requested features?"
- "Find bugs reported this month"
- "Show ideas with the highest RICE scores"
- "What feedback has come from Slack in the last week?"`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language query about ideas' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },

  // --- Signals ---
  {
    name: 'list_signals',
    description: 'List signals (external feedback from Twitter, Reddit, support tickets, etc.) with optional filters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: { type: 'string', description: 'Filter signals linked to a specific idea' },
        source: { type: 'string', description: 'Filter by signal source (twitter, reddit, helpscout, etc.)' },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral', 'mixed'],
          description: 'Filter by sentiment',
        },
        category: {
          type: 'string',
          enum: ['feature_request', 'bug_report', 'praise', 'complaint', 'question', 'mention'],
          description: 'Filter by category',
        },
        limit: { type: 'number', description: 'Number of signals to return (max 100)', default: 20 },
        offset: { type: 'number', description: 'Offset for pagination', default: 0 },
      },
      required: [],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'get_signal_analytics',
    description: 'Get aggregated analytics about signals over a time period.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD format)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD format)' },
        groupBy: {
          type: 'string',
          enum: ['day', 'week', 'month', 'source', 'sentiment', 'category'],
          description: 'How to group the analytics',
          default: 'day',
        },
      },
      required: ['startDate', 'endDate'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'attach_signal',
    description: 'Link a signal to an idea. This associates external feedback with a specific product idea.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        signalId: { type: 'string', description: 'The ID of the signal to attach' },
        ideaId: { type: 'string', description: 'The ID of the idea to attach the signal to' },
      },
      required: ['signalId', 'ideaId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },

  // --- Decisions ---
  {
    name: 'log_decision',
    description: `Log a decision event for an idea. This creates an audit trail entry.

Event types:
- created, updated: Lifecycle events
- accepted, rejected, snoozed, expired: Decision outcomes
- reopened: Reopen a closed idea
- merged, superseded: Idea was consolidated
- shipped: Feature was released
- ticket_created, ticket_closed: External ticket lifecycle

Closure categories (required for some events):
- shipped, merged: Positive closures
- deferred_resources, deferred_priority, deferred_dependency, deferred_timing: Deferrals
- rejected_scope, rejected_alternative, rejected_invalid, rejected_duplicate: Rejections`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: { type: 'string', description: 'The ID of the idea' },
        eventType: {
          type: 'string',
          enum: [
            'created', 'updated', 'accepted', 'rejected', 'snoozed', 'expired',
            'reopened', 'merged', 'superseded', 'unmerged', 'ticket_created',
            'ticket_closed', 'shipped', 'signal_recorded', 'surfaced',
            'confidence_updated', 'category_changed', 'relationship_added', 'relationship_removed',
          ],
          description: 'Type of decision event',
        },
        closureCategory: {
          type: 'string',
          enum: [
            'shipped', 'merged', 'deferred_resources', 'deferred_priority',
            'deferred_dependency', 'deferred_timing', 'rejected_scope',
            'rejected_alternative', 'rejected_invalid', 'rejected_duplicate',
            'expired', 'superseded',
          ],
          description: 'Category for closure events',
        },
        reason: { type: 'string', description: 'Reason or notes for the decision' },
        confidenceScore: { type: 'number', description: 'Confidence score (0-1)' },
      },
      required: ['ideaId', 'eventType'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'get_decision_history',
    description: 'Get the complete decision history (audit trail) for an idea.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: { type: 'string', description: 'The ID of the idea to get history for' },
      },
      required: ['ideaId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },

  // --- Relationships ---
  {
    name: 'create_relationship',
    description: `Create a relationship between two ideas.

Relationship types:
- related_to: General relationship (bidirectional)
- alternative_to: Ideas that solve the same problem differently (bidirectional)
- superseded_by: This idea was replaced by another (directional)
- merged_into: This idea was merged into another (directional)
- blocked_by: This idea depends on another (directional)
- parent_of: This is a parent/epic of another idea (directional)
- derived_from: This idea was inspired by another (directional)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceIdeaId: { type: 'string', description: 'The source idea ID' },
        targetIdeaId: { type: 'string', description: 'The target idea ID' },
        relationshipType: {
          type: 'string',
          enum: ['related_to', 'alternative_to', 'superseded_by', 'merged_into', 'blocked_by', 'parent_of', 'derived_from'],
          description: 'Type of relationship',
        },
        note: { type: 'string', description: 'Optional note about the relationship' },
      },
      required: ['sourceIdeaId', 'targetIdeaId', 'relationshipType'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
  {
    name: 'list_relationships',
    description: 'Get all relationships for an idea (both as source and target).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ideaId: { type: 'string', description: 'The ID of the idea to get relationships for' },
      },
      required: ['ideaId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/visibility': 'public' },
  },
];

// =============================================================================
// Routing Set
// =============================================================================

export const PROXY_TOOL_NAMES = new Set(proxyTools.map(t => t.name));

// =============================================================================
// Generic Proxy Handler
// =============================================================================

/**
 * Handle a proxied tool call by forwarding to the main app's MCP handler.
 * Returns MCP-formatted content (text content array).
 */
export async function handleProxyTool(
  toolName: string,
  args: Record<string, unknown>,
  chatgptSubjectId: string
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  try {
    const response = await idealiftClient.mcpProxy(
      chatgptSubjectId,
      'tools/call',
      { name: toolName, arguments: args }
    );

    if (response.error) {
      return {
        content: [{ type: 'text', text: `Error: ${response.error.message}` }],
        isError: true,
      };
    }

    // The result from handleJsonRpcRequest for tools/call is { content: [...], isError?: boolean }
    const result = response.result as { content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined;

    if (result?.content) {
      return {
        content: result.content,
        isError: result.isError || false,
      };
    }

    // Fallback: wrap the result as text
    return {
      content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }],
      isError: false,
    };
  } catch (error) {
    console.error(`[ProxyTool] Error calling ${toolName}:`, error);
    return {
      content: [{ type: 'text', text: `Proxy error: ${(error as Error).message}` }],
      isError: true,
    };
  }
}
