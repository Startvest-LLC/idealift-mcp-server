import { z } from 'zod';

// Input schema
const ConnectDestinationInput = z.object({
  destination: z.enum(['github', 'jira', 'linear']),
});

export interface ConnectDestinationResult {
  destination: 'github' | 'jira' | 'linear';
  connectUrl: string;
  instructions: string;
}

// Tool definition for MCP
export const connectDestinationTool = {
  name: 'connect_destination',
  description: `Connect a ticket destination (GitHub, Jira, or Linear) to IdeaLift.

USE this tool when:
- User explicitly says "connect GitHub", "link my Jira", "add Linear"
- User tried to create a ticket but the destination isn't connected
- list_destinations showed no integrations and user wants to add one

DO NOT use this tool when:
- User is just exploring ideas (no connection needed)
- User hasn't expressed intent to connect anything
- User is asking ABOUT integrations (use list_destinations instead)

Returns a link the user clicks to authorize. Connection takes ~30 seconds.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      destination: {
        type: 'string',
        enum: ['github', 'jira', 'linear'],
        description: 'Which service to connect',
      },
    },
    required: ['destination'],
  },
  annotations: {
    readOnlyHint: true,     // Only generates a URL string for user to click - no database or API writes
    destructiveHint: false, // Pure URL generation, no side effects
    openWorldHint: false,   // No external HTTP calls - just builds a URL from environment variables
  },
  _meta: {
    'openai/visibility': 'public',
  },
};

export async function handleConnectDestination(
  args: Record<string, unknown>,
  chatgptSubjectId?: string
): Promise<{ structuredContent: ConnectDestinationResult; content: string }> {
  const input = ConnectDestinationInput.parse(args);
  const idealiftUrl = process.env.IDEALIFT_APP_URL || 'https://idealift.app';

  // Build OAuth initiation URL that includes ChatGPT context
  const returnContext = chatgptSubjectId ? `?chatgpt_subject=${encodeURIComponent(chatgptSubjectId)}` : '';

  const destinationConfig = {
    github: {
      name: 'GitHub',
      path: '/api/github/connect',
      instructions: 'Click the link to authorize GitHub access. Select which repositories IdeaLift can create issues in, then return here.',
    },
    jira: {
      name: 'Jira',
      path: '/api/jira/connect',
      instructions: 'Click the link to connect your Atlassian account. Select your Jira site and projects, then return here.',
    },
    linear: {
      name: 'Linear',
      path: '/api/linear/connect',
      instructions: 'Click the link to authorize Linear access. IdeaLift will be able to create issues in your Linear workspace.',
    },
  };

  const config = destinationConfig[input.destination];
  const connectUrl = `${idealiftUrl}${config.path}${returnContext}`;

  const result: ConnectDestinationResult = {
    destination: input.destination,
    connectUrl,
    instructions: config.instructions,
  };

  return {
    structuredContent: result,
    content: `## Connect ${config.name}

${config.instructions}

**[Click here to connect ${config.name}](${connectUrl})**

Once connected, come back here and I'll help you create your first ticket!`,
  };
}
