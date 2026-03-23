import { z } from 'zod';
import { idealiftClient } from '../../lib/idealift-client.js';

// Input schema
const NormalizeIdeaInput = z.object({
  text: z.string().min(1).max(10000),
  context: z.object({
    source: z.literal('chatgpt').optional(),
  }).optional(),
});

// Signal extraction - operational intelligence
export interface SignalSummary {
  urgency: 'low' | 'medium' | 'high' | 'critical';
  clarity: 'low' | 'medium' | 'high';
  duplicateRisk: 'low' | 'medium' | 'high';
  suggestedOwner: string;
  sourceType: 'user-reported' | 'internal' | 'automated' | 'unknown';
  actionability: 'ready' | 'needs-clarification' | 'needs-research';
}

// Output schema - comprehensive ticket spec
export interface NormalizeResult {
  title: string;
  type: 'story' | 'bug' | 'task' | 'spike' | 'epic';
  priority: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  labels: string[];
  summary: string;
  acceptanceCriteria: string[];
  implementationNotes: string[];
  outOfScope: string[];
  definitionOfDone: string[];
  // Signal extraction - operational intelligence
  signals: SignalSummary;
  // Legacy fields for backwards compatibility
  keyPoints: string[];
  category: 'feature' | 'bug' | 'improvement' | 'research' | 'documentation' | 'other';
  actionable: boolean;
  confidence: number;
}

// Tool definition for MCP
export const normalizeIdeaTool = {
  name: 'normalize_idea',
  description: `Transform raw ideas into execution-ready work items. This is the moment where thinking stops and execution begins.

IdeaLift is a COMMIT LAYER - it judges whether an idea is ready for execution and helps make it real.

USE this tool when you detect intent signals like:
- "We should..." / "What if we..." / "Someone suggested..."
- "This is annoying..." / "Users keep asking for..."
- "Feature request:" / "Bug report:" / "Can we add..."
- User pastes meeting notes, Slack threads, or raw text
- User says "normalize", "make this backlog-ready", "turn this into a ticket"

When you detect these signals, PROACTIVELY offer:
"This looks like a feature idea. Want me to make it execution-ready?"

Output includes:
- Readiness Verdict (READY / ALMOST READY / NOT READY)
- Signal Analysis (urgency, clarity, duplicate risk, actionability)
- Structured spec (summary, acceptance criteria, scope)
- Commit options (GitHub, Jira, Linear, or Refine)

The output ALWAYS ends with a commit decision - never leave users in limbo.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string',
        description: 'The raw text to normalize (meeting notes, feature request, bug report, slack message, etc.)',
      },
      context: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['chatgpt'],
          },
        },
      },
    },
    required: ['text'],
  },
  annotations: {
    readOnlyHint: false,    // Saves draft to database for later retrieval
    destructiveHint: false, // Creates new drafts, never deletes existing data
    openWorldHint: true,    // Calls IdeaLift API for AI normalization
  },
  _meta: {
    'openai/outputTemplate': 'resource://widget/preview',
    'openai/widgetAccessible': true,
    'openai/visibility': 'public',
    'openai/toolInvocation/invoking': 'Creating comprehensive spec...',
    'openai/toolInvocation/invoked': 'Spec ready for review',
  },
};

function getReadinessVerdict(result: NormalizeResult): { ready: boolean; verdict: string; missing: string[] } {
  const missing: string[] = [];

  // Check clarity
  if (result.signals?.clarity === 'low') {
    missing.push('Problem statement needs more detail');
  }

  // Check acceptance criteria
  if (!result.acceptanceCriteria || result.acceptanceCriteria.length < 2) {
    missing.push('Acceptance criteria incomplete');
  }

  // Check actionability
  if (result.signals?.actionability === 'needs-research') {
    missing.push('Requires research spike first');
  }

  // Check for scope
  if (!result.outOfScope || result.outOfScope.length === 0) {
    missing.push('Scope boundaries not defined');
  }

  const ready = missing.length === 0 && result.signals?.actionability === 'ready';

  let verdict: string;
  if (ready) {
    verdict = '✅ READY TO COMMIT — This item is execution-ready.';
  } else if (missing.length <= 1) {
    verdict = '🟡 ALMOST READY — Minor refinement needed before committing.';
  } else {
    verdict = '🔴 NOT READY — This needs clarification before it should be committed.';
  }

  return { ready, verdict, missing };
}

function formatComprehensiveOutput(result: NormalizeResult, draftId?: string): string {
  const sections: string[] = [];
  const readiness = getReadinessVerdict(result);

  // Header with mode indicator and draft ID
  sections.push('---');
  if (draftId) {
    sections.push(`**📋 IdeaLift Commit Mode** | Draft: \`${draftId}\``);
  } else {
    sections.push('**📋 IdeaLift Commit Mode**');
  }
  sections.push('---');
  sections.push('');

  // Title
  sections.push(`# ${result.title}`);
  sections.push('');

  // Metadata line
  const typeLabel = result.type.charAt(0).toUpperCase() + result.type.slice(1);
  const priorityLabel = result.priority.charAt(0).toUpperCase() + result.priority.slice(1);
  sections.push(`**Type:** ${typeLabel} | **Priority:** ${priorityLabel} | **Component:** ${result.component}`);

  // Labels
  if (result.labels && result.labels.length > 0) {
    sections.push(`**Labels:** ${result.labels.join(', ')}`);
  }
  sections.push('');

  // READINESS VERDICT - The key differentiator
  sections.push('## Readiness Verdict');
  sections.push(readiness.verdict);
  if (readiness.missing.length > 0) {
    sections.push('');
    sections.push('**Missing:**');
    readiness.missing.forEach(item => sections.push(`- ${item}`));
  }
  sections.push('');

  // Signal Summary
  if (result.signals) {
    sections.push('## Signal Analysis');
    const urgencyEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[result.signals.urgency] || '⚪';
    const clarityEmoji = { low: '❓', medium: '💭', high: '✅' }[result.signals.clarity] || '⚪';
    const actionEmoji = { ready: '🚀', 'needs-clarification': '❓', 'needs-research': '🔬' }[result.signals.actionability] || '⚪';

    sections.push(`| Signal | Value |`);
    sections.push(`|--------|-------|`);
    sections.push(`| Urgency | ${urgencyEmoji} ${result.signals.urgency.charAt(0).toUpperCase() + result.signals.urgency.slice(1)} |`);
    sections.push(`| Clarity | ${clarityEmoji} ${result.signals.clarity.charAt(0).toUpperCase() + result.signals.clarity.slice(1)} |`);
    sections.push(`| Duplicate Risk | ${result.signals.duplicateRisk.charAt(0).toUpperCase() + result.signals.duplicateRisk.slice(1)} |`);
    sections.push(`| Suggested Owner | ${result.signals.suggestedOwner} |`);
    sections.push(`| Source | ${result.signals.sourceType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} |`);
    sections.push(`| Execution Ready | ${actionEmoji} ${result.signals.actionability.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} |`);
    sections.push('');
  }

  // Summary
  sections.push('## Summary');
  sections.push(result.summary);
  sections.push('');

  // Acceptance Criteria
  if (result.acceptanceCriteria && result.acceptanceCriteria.length > 0) {
    sections.push('## Acceptance Criteria');
    result.acceptanceCriteria.forEach((ac, i) => {
      sections.push(`${i + 1}. ${ac}`);
    });
    sections.push('');
  }

  // Implementation Notes
  if (result.implementationNotes && result.implementationNotes.length > 0) {
    sections.push('## Implementation Notes');
    result.implementationNotes.forEach(note => {
      sections.push(`- ${note}`);
    });
    sections.push('');
  }

  // Out of Scope
  if (result.outOfScope && result.outOfScope.length > 0) {
    sections.push('## Out of Scope');
    result.outOfScope.forEach(item => {
      sections.push(`- ${item}`);
    });
    sections.push('');
  }

  // Definition of Done
  if (result.definitionOfDone && result.definitionOfDone.length > 0) {
    sections.push('## Definition of Done');
    result.definitionOfDone.forEach(item => {
      sections.push(`- [ ] ${item}`);
    });
    sections.push('');
  }

  // COMMIT OPTIONS - Always end with a decision
  sections.push('---');
  sections.push('## What would you like to do?');
  sections.push('');
  if (readiness.ready) {
    sections.push('This is ready to commit. Choose a destination:');
  } else {
    sections.push('You can commit now or refine first:');
  }
  sections.push('');
  sections.push('1. **Commit to GitHub** — Create as GitHub issue');
  sections.push('2. **Commit to Jira** — Create as Jira ticket');
  sections.push('3. **Commit to Linear** — Create as Linear issue');
  sections.push('4. **Refine** — Clarify scope, add acceptance criteria, or adjust priority');
  sections.push('');
  sections.push('*Just say "commit to GitHub" or "refine the acceptance criteria"*');

  return sections.join('\n');
}

export interface NormalizeOutput {
  structuredContent: NormalizeResult & { draftId?: string };
  content: string;
}

export async function handleNormalizeIdea(
  args: Record<string, unknown>,
  chatgptSubjectId?: string
): Promise<NormalizeOutput> {
  // Validate input
  const input = NormalizeIdeaInput.parse(args);

  let result: NormalizeResult;
  let draftId: string | undefined;

  try {
    // Call IdeaLift internal API
    result = await idealiftClient.normalize(input.text);
  } catch (error) {
    console.error('Normalize idea error:', error);

    // Fallback: basic text extraction
    const lines = input.text.split('\n').filter(l => l.trim());
    const title = lines[0]?.substring(0, 80) || 'Untitled Idea';
    const summary = lines.slice(0, 3).join(' ').substring(0, 500);

    result = {
      title,
      type: 'story',
      priority: 'medium',
      component: 'General',
      labels: [],
      summary,
      acceptanceCriteria: lines.slice(1, 4).map(l => l.substring(0, 200)),
      implementationNotes: [],
      outOfScope: [],
      definitionOfDone: ['Implementation complete', 'Code reviewed', 'Tests passing'],
      signals: {
        urgency: 'medium',
        clarity: 'low',
        duplicateRisk: 'medium',
        suggestedOwner: 'Product',
        sourceType: 'unknown',
        actionability: 'needs-clarification'
      },
      keyPoints: lines.slice(1, 4).map(l => l.substring(0, 100)),
      category: 'other',
      actionable: true,
      confidence: 0.3,
    };
  }

  // Save draft for later commit (survives context loss)
  try {
    const draftResponse = await idealiftClient.saveDraft(
      chatgptSubjectId,
      result.title,
      result.summary,
      result as unknown as Record<string, unknown>
    );
    draftId = draftResponse.draftId;
    console.log('[Normalize] Saved draft:', draftId);
  } catch (draftError) {
    console.error('[Normalize] Failed to save draft:', draftError);
    // Continue without draft - commit will still work with full idea object
  }

  const content = formatComprehensiveOutput(result, draftId);

  return {
    structuredContent: { ...result, draftId },
    content,
  };
}
