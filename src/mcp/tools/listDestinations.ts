import { idealiftClient } from '../../lib/idealift-client.js';

export interface Destination {
  type: 'github' | 'jira' | 'linear';
  connected: boolean;
  name: string;
  default: boolean;
  config?: {
    repo?: string;
    projectKey?: string;
    teamId?: string;
  };
}

export interface ListDestinationsResult {
  authenticated: boolean;
  workspaceName?: string;
  destinations: Destination[];
  authUrl?: string;
}

// Tool definition for MCP
export const listDestinationsTool = {
  name: 'list_destinations',
  description: `List connected COMMIT destinations (GitHub repos, Jira projects, Linear teams).

These are where ideas become REAL. After normalizing an idea, show the user where they can commit it.

USE this tool when:
- After normalize_idea, to show commit options
- User asks "where can I commit?", "show my repos", "what's connected?"
- User is ready to commit but needs to choose a destination

DO NOT use this tool when:
- User is still exploring or drafting ideas (doesn't need destinations yet)
- User is just using normalize_idea (show inline commit options instead)

This tool requires IdeaLift authentication. Normalizing ideas is free, committing requires connection.`,
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  annotations: {
    readOnlyHint: true,     // Pure read operation - only fetches and returns connected destinations
    destructiveHint: false, // Read-only query, no data modification
    openWorldHint: true,    // Calls IdeaLift API to fetch destinations
  },
  _meta: {
    'openai/visibility': 'public',
  },
};

export async function handleListDestinations(
  chatgptSubjectId?: string
): Promise<{ structuredContent: ListDestinationsResult; content: string }> {
  const idealiftUrl = process.env.IDEALIFT_APP_URL || 'https://idealift.app';

  if (!chatgptSubjectId) {
    return {
      structuredContent: {
        authenticated: false,
        destinations: [],
      },
      content: `## Connect IdeaLift First

To see and use your ticket destinations, connect your IdeaLift account by re-adding the IdeaLift app in ChatGPT settings to trigger the OAuth flow.

**In the meantime:** Use **normalize_idea** to structure your ideas - I'll save them for when you're connected!`,
    };
  }

  try {
    const result = await idealiftClient.listDestinations(chatgptSubjectId);

    if (!result.authenticated) {
      return {
        structuredContent: result,
        content: `## Connect IdeaLift First

To see and use your ticket destinations, connect your IdeaLift account.

**In the meantime:** Use **normalize_idea** to structure your ideas!`,
      };
    }

    const connected = result.destinations.filter(d => d.connected);
    if (connected.length === 0) {
      return {
        structuredContent: result,
        content: `## No Commit Destinations Yet

You're connected to **${result.workspaceName}**, but haven't connected anywhere to commit ideas.

**Connect a destination to start committing:**
- **GitHub** - Commit ideas as GitHub issues
- **Jira** - Commit ideas as Jira tickets
- **Linear** - Commit ideas as Linear issues

Just say "connect GitHub" (or Jira/Linear) and I'll walk you through it!`,
      };
    }

    // Build a nice table of destinations
    const destLines = connected.map(d => {
      const icon = d.type === 'github' ? '🐙' : d.type === 'jira' ? '🔷' : '📐';
      const defaultBadge = d.default ? ' *(default)*' : '';
      const config = d.config?.repo || d.config?.projectKey || d.config?.teamId || '';
      return `| ${icon} ${d.type.charAt(0).toUpperCase() + d.type.slice(1)} | ${d.name} | ${config}${defaultBadge} |`;
    });

    return {
      structuredContent: result,
      content: `## Your Commit Destinations

| Service | Name | Details |
|---------|------|---------|
${destLines.join('\n')}

**Ready to commit?** Just say "commit to GitHub" (or Jira/Linear), or I'll use your default.

**Need to connect more?** Say "connect GitHub" (or Jira/Linear).`,
    };
  } catch (error) {
    console.error('List destinations error:', error);

    return {
      structuredContent: {
        authenticated: false,
        destinations: [],
      },
      content: `## Couldn't Load Destinations

There was an issue loading your destinations. This might be temporary.

**Try:** Say "check my connection" to verify your IdeaLift status.`,
    };
  }
}
