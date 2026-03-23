import type { NormalizeResult } from '../mcp/tools/normalizeIdea.js';
import type { CheckAuthResult } from '../mcp/tools/checkAuth.js';
import type { ListDestinationsResult } from '../mcp/tools/listDestinations.js';
import type { CreateTicketResult } from '../mcp/tools/createTicket.js';

const IDEALIFT_APP_URL = process.env.IDEALIFT_APP_URL || 'https://idealift-app.azurewebsites.net';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

async function internalFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${IDEALIFT_APP_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IdeaLift API error (${response.status}): ${error}`);
  }

  return response.json() as Promise<T>;
}

export const idealiftClient = {
  /**
   * Normalize raw text into a structured idea
   */
  async normalize(text: string): Promise<NormalizeResult> {
    return internalFetch<NormalizeResult>('/api/internal/normalize', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  /**
   * Check if a ChatGPT user is authenticated with IdeaLift
   */
  async checkAuth(chatgptSubjectId: string): Promise<CheckAuthResult> {
    return internalFetch<CheckAuthResult>(
      `/api/internal/auth?chatgptSubjectId=${encodeURIComponent(chatgptSubjectId)}`
    );
  },

  /**
   * List available destinations for a user
   */
  async listDestinations(chatgptSubjectId: string): Promise<ListDestinationsResult> {
    return internalFetch<ListDestinationsResult>(
      `/api/internal/destinations?chatgptSubjectId=${encodeURIComponent(chatgptSubjectId)}`
    );
  },

  /**
   * Check for duplicate ideas
   */
  async checkDuplicates(
    chatgptSubjectId: string,
    title: string,
    summary: string
  ): Promise<{ found: boolean; existingUrl?: string; similarity?: number; ideaLiftId?: string }> {
    return internalFetch('/api/internal/check-dupes', {
      method: 'POST',
      body: JSON.stringify({
        chatgptSubjectId,
        title,
        summary,
      }),
    });
  },

  /**
   * Create a ticket in the destination system
   */
  async createTicket(
    chatgptSubjectId: string,
    destination: 'github' | 'jira' | 'linear',
    idea: {
      title: string;
      summary: string;
      keyPoints?: string[];
      category?: string;
      priority?: string;
    },
    destinationConfig?: {
      repo?: string;
      projectKey?: string;
      issueType?: string;
      teamId?: string;
    }
  ): Promise<CreateTicketResult> {
    return internalFetch<CreateTicketResult>('/api/internal/create-ticket', {
      method: 'POST',
      body: JSON.stringify({
        chatgptSubjectId,
        destination,
        idea,
        destinationConfig,
      }),
    });
  },

  /**
   * Create or update a ChatGPT connection linking subject ID to workspace
   */
  async createConnection(
    chatgptSubjectId: string,
    workspaceId: string,
    displayName?: string
  ): Promise<{ success: boolean; action: string; connectionId?: string }> {
    return internalFetch('/api/internal/chatgpt-connect', {
      method: 'POST',
      body: JSON.stringify({
        chatgptSubjectId,
        workspaceId,
        displayName,
      }),
    });
  },

  /**
   * Save a normalized draft for later commit
   */
  async saveDraft(
    chatgptSubjectId: string | undefined,
    title: string,
    summary: string,
    normalizedData: Record<string, unknown>
  ): Promise<{ success: boolean; draftId: string; expiresAt: string }> {
    return internalFetch('/api/internal/drafts', {
      method: 'POST',
      body: JSON.stringify({
        chatgptSubjectId,
        title,
        summary,
        normalizedData,
      }),
    });
  },

  /**
   * Get a draft by ID or most recent for user
   */
  async getDraft(
    draftId?: string,
    chatgptSubjectId?: string
  ): Promise<{
    found: boolean;
    draftId?: string;
    title?: string;
    summary?: string;
    normalizedData?: Record<string, unknown>;
  }> {
    const params = new URLSearchParams();
    if (draftId) params.set('draftId', draftId);
    if (chatgptSubjectId) params.set('chatgptSubjectId', chatgptSubjectId);

    return internalFetch(`/api/internal/drafts?${params.toString()}`);
  },

  /**
   * Mark a draft as committed
   */
  async markDraftCommitted(
    draftId: string,
    committedTo: string,
    committedUrl?: string
  ): Promise<{ success: boolean }> {
    return internalFetch('/api/internal/drafts', {
      method: 'PATCH',
      body: JSON.stringify({
        draftId,
        committedTo,
        committedUrl,
      }),
    });
  },

  /**
   * Proxy a JSON-RPC request to the main app's MCP handler.
   * Gives ChatGPT MCP users access to all 13 Claude MCP tools.
   */
  async mcpProxy(
    chatgptSubjectId: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<{ jsonrpc: string; id: number; result?: unknown; error?: { code: number; message: string } }> {
    return internalFetch('/api/internal/mcp/proxy', {
      method: 'POST',
      body: JSON.stringify({
        chatgptSubjectId,
        id: 1,
        method,
        params,
      }),
    });
  },
};
