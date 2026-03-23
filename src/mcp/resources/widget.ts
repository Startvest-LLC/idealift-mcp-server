/**
 * Returns the HTML for the IdeaLift widget rendered inside ChatGPT.
 * This widget handles:
 * - Displaying normalized idea preview
 * - Destination selection
 * - Create ticket button
 * - Authentication prompts
 * - Success/error states
 */
export function getWidgetHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IdeaLift</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a1a;
      background: #ffffff;
      padding: 16px;
    }

    .container {
      max-width: 480px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e5e5;
    }

    .logo {
      font-weight: 600;
      font-size: 16px;
      color: #6366f1;
    }

    .badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #f0f0f0;
      color: #666;
    }

    .preview-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .preview-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #111827;
    }

    .preview-summary {
      color: #4b5563;
      margin-bottom: 12px;
    }

    .preview-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #6b7280;
    }

    .meta-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }

    .meta-badge.category {
      background: #dbeafe;
      color: #1e40af;
    }

    .meta-badge.priority-high {
      background: #fee2e2;
      color: #991b1b;
    }

    .meta-badge.priority-medium {
      background: #fef3c7;
      color: #92400e;
    }

    .meta-badge.priority-low {
      background: #d1fae5;
      color: #065f46;
    }

    .key-points {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }

    .key-points-title {
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
    }

    .key-points ul {
      list-style: none;
      padding-left: 0;
    }

    .key-points li {
      position: relative;
      padding-left: 16px;
      margin-bottom: 4px;
      font-size: 13px;
      color: #4b5563;
    }

    .key-points li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #9ca3af;
    }

    .destination-picker {
      margin-bottom: 16px;
    }

    .destination-label {
      font-size: 12px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 8px;
    }

    .destination-options {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .destination-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      background: white;
    }

    .destination-option:hover {
      border-color: #6366f1;
    }

    .destination-option.selected {
      border-color: #6366f1;
      background: #eef2ff;
    }

    .destination-option.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .destination-icon {
      width: 16px;
      height: 16px;
    }

    .destination-name {
      font-size: 13px;
      font-weight: 500;
    }

    .destination-project {
      font-size: 11px;
      color: #6b7280;
    }

    .actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      border: none;
    }

    .btn-primary {
      background: #6366f1;
      color: white;
    }

    .btn-primary:hover {
      background: #4f46e5;
    }

    .btn-primary:disabled {
      background: #a5b4fc;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: white;
      color: #374151;
      border: 1px solid #e5e7eb;
    }

    .btn-secondary:hover {
      background: #f9fafb;
    }

    /* Auth prompt state */
    .auth-prompt {
      text-align: center;
      padding: 24px;
    }

    .auth-prompt h3 {
      font-size: 16px;
      margin-bottom: 8px;
    }

    .auth-prompt p {
      color: #6b7280;
      margin-bottom: 16px;
    }

    /* Success state */
    .success-card {
      text-align: center;
      padding: 24px;
    }

    .success-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    .success-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #059669;
    }

    .success-link {
      color: #6366f1;
      text-decoration: none;
      font-weight: 500;
    }

    .success-link:hover {
      text-decoration: underline;
    }

    .idealift-id {
      margin-top: 12px;
      font-size: 12px;
      color: #6b7280;
    }

    /* Loading state */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      color: #6b7280;
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #e5e7eb;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Duplicate warning */
    .duplicate-warning {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .duplicate-warning-title {
      font-weight: 600;
      color: #92400e;
      margin-bottom: 4px;
    }

    .duplicate-warning-text {
      font-size: 13px;
      color: #78350f;
    }
  </style>
</head>
<body>
  <div class="container" id="app">
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading...</span>
    </div>
  </div>

  <script>
    // Widget state
    let state = {
      view: 'loading', // loading, preview, auth, success, error
      idea: null,
      destinations: [],
      selectedDestination: null,
      authenticated: false,
      authUrl: null,
      result: null,
      error: null,
    };

    // Listen for tool output from ChatGPT
    window.addEventListener('message', (event) => {
      if (event.data.type === 'openai:set_globals') {
        handleToolOutput(event.data.payload);
      }
    });

    // Also check window.openai for initial state
    if (window.openai?.toolOutput) {
      handleToolOutput(window.openai.toolOutput);
    }

    function handleToolOutput(output) {
      if (!output) return;

      const data = output.structuredContent || output;

      // Determine view based on data
      if (data.success !== undefined) {
        // Create ticket result
        if (data.success) {
          state.view = 'success';
          state.result = data;
        } else if (data.duplicate?.found) {
          state.view = 'duplicate';
          state.result = data;
        } else {
          state.view = 'error';
          state.error = data.error;
        }
      } else if (data.title && data.summary) {
        // Normalized idea
        state.view = 'preview';
        state.idea = data;
      } else if (data.authenticated !== undefined) {
        // Auth check result
        state.authenticated = data.authenticated;
        state.authUrl = data.authUrl;
        if (data.destinations) {
          state.destinations = data.destinations;
          state.selectedDestination = data.destinations.find(d => d.default) || data.destinations[0];
        }
        if (!data.authenticated) {
          state.view = 'auth';
        }
      }

      render();
    }

    function render() {
      const app = document.getElementById('app');

      switch (state.view) {
        case 'loading':
          app.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading...</span></div>';
          break;

        case 'preview':
          app.innerHTML = renderPreview();
          attachPreviewListeners();
          break;

        case 'auth':
          app.innerHTML = renderAuthPrompt();
          attachAuthListeners();
          break;

        case 'success':
          app.innerHTML = renderSuccess();
          attachSuccessListeners();
          break;

        case 'duplicate':
          app.innerHTML = renderDuplicateWarning();
          attachDuplicateListeners();
          break;

        case 'error':
          app.innerHTML = renderError();
          break;
      }
    }

    function renderPreview() {
      const idea = state.idea;
      const priorityClass = 'priority-' + (idea.priority || 'medium');

      return \`
        <div class="header">
          <span class="logo">IdeaLift</span>
          <span class="badge">Preview</span>
        </div>
        <div class="preview-card">
          <div class="preview-title">\${escapeHtml(idea.title)}</div>
          <div class="preview-summary">\${escapeHtml(idea.summary)}</div>
          <div class="preview-meta">
            <span class="meta-badge category">\${idea.category || 'other'}</span>
            <span class="meta-badge \${priorityClass}">\${idea.priority || 'medium'}</span>
          </div>
          \${idea.keyPoints?.length ? \`
            <div class="key-points">
              <div class="key-points-title">Key Points</div>
              <ul>
                \${idea.keyPoints.map(p => \`<li>\${escapeHtml(p)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}
        </div>
        \${state.authenticated ? renderDestinationPicker() : ''}
        <div class="actions">
          <button class="btn btn-primary" id="createBtn">
            \${state.authenticated ? 'Create Ticket' : 'Connect IdeaLift'}
          </button>
        </div>
      \`;
    }

    function renderDestinationPicker() {
      if (!state.destinations.length) {
        return '<p style="color:#6b7280;font-size:13px;margin-bottom:16px;">No integrations configured. Add GitHub, Jira, or Linear in IdeaLift.</p>';
      }

      return \`
        <div class="destination-picker">
          <div class="destination-label">Create in:</div>
          <div class="destination-options">
            \${state.destinations.filter(d => d.connected).map(d => \`
              <div class="destination-option \${state.selectedDestination?.type === d.type ? 'selected' : ''}" data-type="\${d.type}">
                <span class="destination-name">\${d.type.charAt(0).toUpperCase() + d.type.slice(1)}</span>
                <span class="destination-project">\${d.name}</span>
              </div>
            \`).join('')}
          </div>
        </div>
      \`;
    }

    function renderAuthPrompt() {
      return \`
        <div class="header">
          <span class="logo">IdeaLift</span>
        </div>
        <div class="auth-prompt">
          <h3>Connect IdeaLift</h3>
          <p>Link your workspace to create tickets in GitHub, Jira, or Linear directly from ChatGPT.</p>
          <button class="btn btn-primary" id="connectBtn">Connect IdeaLift</button>
        </div>
      \`;
    }

    function renderSuccess() {
      const result = state.result;
      return \`
        <div class="header">
          <span class="logo">IdeaLift</span>
        </div>
        <div class="success-card">
          <div class="success-icon">&#10003;</div>
          <div class="success-title">Ticket Created!</div>
          <a href="\${result.ticketUrl}" target="_blank" class="success-link">
            \${result.ticketId}: View in \${state.selectedDestination?.type || 'destination'}
          </a>
          <div class="idealift-id">IdeaLift ID: \${result.ideaLiftId}</div>
          <div style="margin-top:16px;">
            <button class="btn btn-secondary" id="createAnotherBtn">Create Another</button>
          </div>
        </div>
      \`;
    }

    function renderDuplicateWarning() {
      const result = state.result;
      return \`
        <div class="header">
          <span class="logo">IdeaLift</span>
        </div>
        <div class="duplicate-warning">
          <div class="duplicate-warning-title">Similar idea found</div>
          <div class="duplicate-warning-text">
            An idea with \${Math.round((result.duplicate.similarity || 0) * 100)}% similarity already exists.
            <a href="\${result.duplicate.existingUrl}" target="_blank">View existing</a>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" id="createAnywayBtn">Create Anyway</button>
        </div>
      \`;
    }

    function renderError() {
      return \`
        <div class="header">
          <span class="logo">IdeaLift</span>
        </div>
        <div class="auth-prompt">
          <h3>Something went wrong</h3>
          <p>\${escapeHtml(state.error || 'Please try again.')}</p>
          <button class="btn btn-secondary" id="retryBtn">Try Again</button>
        </div>
      \`;
    }

    function attachPreviewListeners() {
      document.querySelectorAll('.destination-option').forEach(el => {
        el.addEventListener('click', () => {
          const type = el.dataset.type;
          state.selectedDestination = state.destinations.find(d => d.type === type);
          render();
        });
      });

      document.getElementById('createBtn')?.addEventListener('click', () => {
        if (state.authenticated) {
          createTicket();
        } else {
          openAuthPopup();
        }
      });
    }

    function attachAuthListeners() {
      document.getElementById('connectBtn')?.addEventListener('click', openAuthPopup);
    }

    function attachSuccessListeners() {
      document.getElementById('createAnotherBtn')?.addEventListener('click', () => {
        state.view = 'preview';
        state.result = null;
        render();
      });
    }

    function attachDuplicateListeners() {
      document.getElementById('cancelBtn')?.addEventListener('click', () => {
        state.view = 'preview';
        state.result = null;
        render();
      });

      document.getElementById('createAnywayBtn')?.addEventListener('click', () => {
        createTicket(true);
      });
    }

    function openAuthPopup() {
      if (state.authUrl) {
        window.open(state.authUrl, '_blank', 'width=600,height=700');
      }
    }

    function createTicket(force = false) {
      if (window.openai?.callTool) {
        window.openai.callTool('create_ticket', {
          destination: state.selectedDestination?.type || 'github',
          idea: state.idea,
          destinationConfig: state.selectedDestination?.config,
          force,
        });
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Initial render
    render();
  </script>
</body>
</html>`;
}
