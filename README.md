# IdeaLift MCP Server

[![idealift-mcp-server MCP server](https://glama.ai/mcp/servers/Startvest-LLC/idealift-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/Startvest-LLC/idealift-mcp-server)

Decision intelligence for AI assistants via [Model Context Protocol](https://modelcontextprotocol.io).

[![idealift-mcp-server MCP server](https://glama.ai/mcp/servers/Startvest-LLC/idealift-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/Startvest-LLC/idealift-mcp-server)

Connect Claude, ChatGPT, and other AI assistants to your product backlog. Capture feedback, track decisions, and manage ideas without leaving your AI workflow.

## What it does

- **Normalize ideas** — Transform raw text into structured feature requests, bug reports, or tasks
- **Signal aggregation** — Capture product feedback from Slack, Teams, Discord, and GitHub
- **Decision tracking** — Record who decided what, when, and why with full audit trails
- **RICE scoring** — Prioritize ideas with Reach, Impact, Confidence, and Effort scores
- **Ticket creation** — Push structured ideas to GitHub Issues, Jira, or Linear

## MCP Tools

| Tool | Auth Required | Description |
|------|:---:|-------------|
| `normalize_idea` | No | Transform raw text into a structured idea |
| `check_auth` | No | Check if user is linked to IdeaLift |
| `list_destinations` | Yes | Get available GitHub/Jira/Linear projects |
| `create_ticket` | Yes | Create a ticket in a destination system |
| `connect_destination` | Yes | Connect a new destination |

Plus proxy tools for full IdeaLift API access (ideas, signals, decisions, roadmap).

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `IDEALIFT_APP_URL` | IdeaLift API base URL |
| `INTERNAL_API_KEY` | Service-to-service auth key |
| `DATABASE_HOST` | SQL Server host |
| `DATABASE_NAME` | Database name |
| `DATABASE_USERNAME` | Database user |
| `DATABASE_PASSWORD` | Database password |
| `OPENAI_API_KEY` | For idea normalization |

### 3. Build and run

```bash
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

The MCP server starts on port 3001 (configurable via `PORT`).

### 4. Connect to your AI assistant

**SSE endpoint:** `http://localhost:3001/mcp`

Add this URL as an MCP server in Claude Desktop, ChatGPT, or any MCP-compatible client.

## Transport

Uses Server-Sent Events (SSE) transport with automatic keep-alive pings every 15 seconds.

## OAuth

Built-in OAuth 2.0 flow for connecting AI assistant users to their IdeaLift accounts. Supports authorization code grant with PKCE.

## Deployment

Deployed as an Azure App Service. See the [IdeaLift docs](https://idealift.app/mcp) for hosted access.

## License

MIT
