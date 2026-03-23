import { z } from 'zod';
import { idealiftClient } from '../../lib/idealift-client.js';

// Input schema - idea is optional if draftId is provided
const CreateTicketInput = z.object({
  destination: z.enum(['github', 'jira', 'linear']),
  idea: z.object({
    title: z.string().min(1).max(255),
    summary: z.string(),
    keyPoints: z.array(z.string()).optional(),
    category: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(), // Now optional - can use draftId instead
  draftId: z.string().optional(), // Reference to saved draft
  destinationConfig: z.object({
    repo: z.string().optional(),
    projectKey: z.string().optional(),
    issueType: z.string().optional(),
    teamId: z.string().optional(),
  }).optional(),
  force: z.boolean().optional(), // Skip duplicate check
});

export interface CreateTicketResult {
  success: boolean;
  ticketUrl?: string;
  ticketId?: string;
  ideaLiftId?: string;
  duplicate?: {
    found: boolean;
    existingUrl?: string;
    similarity?: number;
  };
  error?: string;
}

// Tool definition for MCP
export const createTicketTool = {
  name: 'create_ticket',
  description: `COMMIT an idea to GitHub, Jira, or Linear. This makes it real.

This is the final step in the IdeaLift flow: Capture → Normalize → COMMIT.

USE this tool when user says:
- "Commit to GitHub/Jira/Linear"
- "Commit it", "create this", "file this", "ship it", "make it real"
- "Push this to [destination]"
- A number from the commit options (e.g., "1" for GitHub)
- "1", "2", or "3" after seeing commit options

IMPORTANT: If a normalize_idea was just called, use the draftId from that response.
If no draftId is available, pass the full idea object from the normalize output.
NEVER ask the user to re-provide content that was just normalized.

After successful commit, confirm with:
- The ticket URL (clickable)
- The ticket ID
- A clear "COMMITTED" confirmation

This creates a REAL ticket. The user's idea now exists in their system.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      destination: {
        type: 'string',
        enum: ['github', 'jira', 'linear'],
        description: 'Where to create the ticket (github, jira, or linear)',
      },
      idea: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Ticket title' },
          summary: { type: 'string', description: 'Ticket description/body' },
          keyPoints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Acceptance criteria or key points to include',
          },
          category: { type: 'string', description: 'Category (feature, bug, improvement, task)' },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level',
          },
        },
        required: ['title', 'summary'],
      },
      destinationConfig: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'GitHub repo as owner/repo (e.g., startvest/idealift)' },
          projectKey: { type: 'string', description: 'Jira project key (e.g., IDEA)' },
          issueType: { type: 'string', description: 'Jira issue type (e.g., Story, Bug, Task)' },
          teamId: { type: 'string', description: 'Linear team ID' },
        },
      },
      force: {
        type: 'boolean',
        description: 'Skip duplicate check and create anyway',
      },
      draftId: {
        type: 'string',
        description: 'Draft ID from normalize_idea response. Use this instead of idea if available.',
      },
    },
    required: ['destination'], // idea OR draftId required, validated in handler
  },
  annotations: {
    readOnlyHint: false,    // Creates tickets in external systems and updates draft status
    destructiveHint: false, // Creates new tickets (additive), does NOT delete existing tickets or data
    openWorldHint: true,    // Calls IdeaLift API which then calls GitHub/Jira/Linear APIs
  },
  _meta: {
    'openai/outputTemplate': 'resource://widget/success',
    'openai/widgetAccessible': true,
    'openai/visibility': 'public',
    'openai/toolInvocation/invoking': 'Creating ticket...',
    'openai/toolInvocation/invoked': 'Ticket created!',
  },
};

export async function handleCreateTicket(
  args: Record<string, unknown>,
  chatgptSubjectId?: string
): Promise<{ structuredContent: CreateTicketResult; content: string; _meta?: Record<string, unknown> }> {
  const idealiftUrl = process.env.IDEALIFT_APP_URL || 'https://idealift.app';

  // Check authentication
  if (!chatgptSubjectId) {
    return {
      structuredContent: {
        success: false,
        error: 'Not authenticated',
      },
      content: `## Connect IdeaLift to Create Tickets

To create real tickets in GitHub, Jira, or Linear, connect your IdeaLift account first.

**Your idea is ready** - once connected, I can create the ticket immediately!

This takes about 30 seconds and you only need to do it once.`,
      _meta: {
        'mcp/www_authenticate': `Bearer realm="IdeaLift"`,
      },
    };
  }

  // Validate input
  const input = CreateTicketInput.parse(args);

  // Resolve idea from input, draftId, or most recent draft
  let idea = input.idea;
  let usedDraftId = input.draftId;

  if (!idea && input.draftId) {
    // Lookup draft by ID
    console.log('[Create Ticket] Looking up draft:', input.draftId);
    const draft = await idealiftClient.getDraft(input.draftId);
    if (draft.found && draft.normalizedData) {
      idea = {
        title: draft.title!,
        summary: draft.summary!,
        keyPoints: (draft.normalizedData as any).acceptanceCriteria || (draft.normalizedData as any).keyPoints,
        category: (draft.normalizedData as any).category,
        priority: (draft.normalizedData as any).priority,
      };
      console.log('[Create Ticket] Found draft:', draft.draftId);
    }
  }

  if (!idea) {
    // Try to get most recent draft for this user
    console.log('[Create Ticket] No idea or draftId, checking for recent draft...');
    const recentDraft = await idealiftClient.getDraft(undefined, chatgptSubjectId);
    if (recentDraft.found && recentDraft.normalizedData) {
      idea = {
        title: recentDraft.title!,
        summary: recentDraft.summary!,
        keyPoints: (recentDraft.normalizedData as any).acceptanceCriteria || (recentDraft.normalizedData as any).keyPoints,
        category: (recentDraft.normalizedData as any).category,
        priority: (recentDraft.normalizedData as any).priority,
      };
      usedDraftId = recentDraft.draftId;
      console.log('[Create Ticket] Using recent draft:', recentDraft.draftId);
    }
  }

  if (!idea) {
    return {
      structuredContent: {
        success: false,
        error: 'No idea to commit',
      },
      content: `## No Idea to Commit

I don't have an idea ready to commit. Please either:
- Normalize an idea first: "normalize this: [your idea]"
- Provide the idea directly in your commit request

Once you have a normalized idea, just say "commit to ${input.destination}" and I'll create the ticket.`,
    };
  }

  try {
    // Check for duplicates first (unless force is true)
    if (!input.force) {
      const dupeCheck = await idealiftClient.checkDuplicates(
        chatgptSubjectId,
        idea.title,
        idea.summary
      );

      if (dupeCheck.found && dupeCheck.similarity && dupeCheck.similarity > 0.85) {
        return {
          structuredContent: {
            success: false,
            duplicate: dupeCheck,
            error: 'Similar idea already exists',
          },
          content: `## Possible Duplicate Found

A similar idea already exists (${Math.round((dupeCheck.similarity || 0) * 100)}% match):

**[${dupeCheck.existingUrl}](${dupeCheck.existingUrl})**

**Options:**
- Say "create anyway" to create this as a new ticket
- Say "show me the existing one" to review it first
- Modify your idea to differentiate it`,
        };
      }
    }

    // Create the ticket
    const result = await idealiftClient.createTicket(
      chatgptSubjectId,
      input.destination,
      idea,
      input.destinationConfig
    );

    if (result.success) {
      // Mark draft as committed
      if (usedDraftId) {
        try {
          await idealiftClient.markDraftCommitted(usedDraftId, input.destination, result.ticketUrl);
          console.log('[Create Ticket] Marked draft as committed:', usedDraftId);
        } catch (markError) {
          console.error('[Create Ticket] Failed to mark draft committed:', markError);
        }
      }

      const destName = input.destination.charAt(0).toUpperCase() + input.destination.slice(1);
      return {
        structuredContent: result,
        content: `## ✅ COMMITTED to ${destName}!

**[${result.ticketId}](${result.ticketUrl})**

${idea.title}

---
*Tracked in IdeaLift: ${result.ideaLiftId}*

**What's next?**
- Paste another idea to normalize
- Say "show my destinations" to see where else you can commit`,
      };
    } else {
      // Handle specific error cases
      if (result.error?.includes('not connected') || result.error?.includes('integration')) {
        return {
          structuredContent: result,
          content: `## ${input.destination.charAt(0).toUpperCase() + input.destination.slice(1)} Not Connected

You haven't connected ${input.destination.charAt(0).toUpperCase() + input.destination.slice(1)} to IdeaLift yet.

Say **"connect ${input.destination}"** and I'll walk you through it (takes about 30 seconds).

Your idea is saved - we can create the ticket right after you connect!`,
        };
      }

      return {
        structuredContent: result,
        content: `## Couldn't Create Ticket

${result.error || 'Something went wrong.'}

**Try:**
- Say "show my destinations" to verify your connections
- Check that you have access to the target repo/project
- Try again in a moment`,
      };
    }
  } catch (error) {
    console.error('Create ticket error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check if it's a connection/auth error
    if (errorMessage.includes('401') || errorMessage.includes('auth') || errorMessage.includes('token')) {
      return {
        structuredContent: {
          success: false,
          error: errorMessage,
        },
        content: `## Connection Issue

Your IdeaLift session may have expired.

**Try:** Say "check my connection" to refresh your status.

Your idea is ready - we can create the ticket once reconnected!`,
      };
    }

    return {
      structuredContent: {
        success: false,
        error: errorMessage,
      },
      content: `## Something Went Wrong

${errorMessage}

**Try again** or say "check my connection" to troubleshoot.`,
    };
  }
}
