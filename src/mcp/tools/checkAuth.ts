import { idealiftClient } from '../../lib/idealift-client.js';
import { oauthService } from '../../services/oauth-service.js';

export interface CheckAuthResult {
  authenticated: boolean;
  workspaceName?: string;
  plan?: string;
  ideasRemaining?: number;
  authUrl?: string;
}

// Tool definition for MCP
export const checkAuthTool = {
  name: 'check_auth',
  description: `Check the user's IdeaLift connection status for committing ideas.

Normalize is FREE. Commit requires connection.

USE this tool when:
- User explicitly asks "am I connected?", "what's my status?", "check my account"
- User is confused about why a commit isn't working
- You need to verify auth before a create_ticket (commit) attempt

DO NOT use this tool when:
- User is just chatting or exploring ideas (normalizing is free)
- User is using normalize_idea (works without auth)
- There's no indication of connection issues

Note: normalize_idea works WITHOUT auth. Only COMMITTING requires connection.`,
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  annotations: {
    readOnlyHint: false,    // Can create ChatGPT connection record if OAuth token exists but connection doesn't
    destructiveHint: false, // Only creates connection records, never deletes data
    openWorldHint: true,    // Calls IdeaLift API to verify authentication status
  },
  _meta: {
    'openai/visibility': 'public',
  },
};

export async function handleCheckAuth(
  chatgptSubjectId?: string
): Promise<{ structuredContent: CheckAuthResult; content: string }> {
  const idealiftUrl = process.env.IDEALIFT_APP_URL || 'https://idealift.app';

  if (!chatgptSubjectId) {
    return {
      structuredContent: {
        authenticated: false,
      },
      content: `## Not Connected Yet

Your ChatGPT session isn't linked to an IdeaLift account yet.

**To connect:** Remove and re-add the IdeaLift app in ChatGPT settings — this will trigger the OAuth flow to link your workspace.

In the meantime, you can use **normalize_idea** right now to structure your ideas — no account needed!

**Try it:** Paste any rough idea and I'll normalize it into an execution-ready spec.`,
    };
  }

  try {
    let result = await idealiftClient.checkAuth(chatgptSubjectId);

    // If not authenticated, check if we have a valid OAuth token scoped to this subject
    if (!result.authenticated) {
      console.log('[Check Auth] Not authenticated, checking for scoped OAuth token...');

      const tokenInfo = await oauthService.getMostRecentTokenForSubject(chatgptSubjectId);

      if (tokenInfo?.workspaceId) {
        console.log('[Check Auth] Found scoped token, creating connection...', {
          chatgptSubjectId,
          workspaceId: tokenInfo.workspaceId,
          userId: tokenInfo.userId,
        });

        try {
          // Create the ChatGPT connection linking subject ID to workspace
          await idealiftClient.createConnection(
            chatgptSubjectId,
            tokenInfo.workspaceId,
            tokenInfo.userId
          );

          // Retry the auth check now that connection exists
          result = await idealiftClient.checkAuth(chatgptSubjectId);
          console.log('[Check Auth] Connection created, re-checked auth:', { authenticated: result.authenticated });
        } catch (connectError) {
          console.error('[Check Auth] Failed to create connection:', connectError);
        }
      } else {
        console.log('[Check Auth] No valid OAuth token found');
      }
    }

    if (result.authenticated) {
      return {
        structuredContent: result,
        content: `## Connected to IdeaLift ✓

**Workspace:** ${result.workspaceName}
**Plan:** ${result.plan}
**Ideas remaining:** ${result.ideasRemaining} this month

**Ready to commit ideas:**
- Use **normalize_idea** to structure raw text into execution-ready specs
- Use **list_destinations** to see your commit destinations
- Use **create_ticket** to COMMIT ideas to GitHub/Jira/Linear

**Need to connect more destinations?** Just ask to connect GitHub, Jira, or Linear.`,
      };
    } else {
      return {
        structuredContent: result,
        content: `## Account Found, Not Fully Connected

Your IdeaLift account exists but isn't linked to this ChatGPT session.

**To connect:** Remove and re-add the IdeaLift app in ChatGPT settings to trigger the OAuth flow, or visit [IdeaLift](${idealiftUrl}) to manage your account.

In the meantime, you can still use **normalize_idea** to structure your ideas!`,
      };
    }
  } catch (error) {
    console.error('Check auth error:', error);

    return {
      structuredContent: {
        authenticated: false,
      },
      content: `## Connection Check Failed

Couldn't verify your connection status. This might be temporary.

**You can still:**
- Use **normalize_idea** to structure ideas (no auth needed)
- Try connecting again in a moment

If this persists, visit [IdeaLift](${idealiftUrl}) directly.`,
    };
  }
}
