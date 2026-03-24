export {};
/**
 * Entry point router — detects transport mode and delegates.
 *
 * When stdin is piped (e.g. by mcp-proxy), runs in stdio mode for tool
 * inspection by Glama and other MCP clients. Otherwise starts the full
 * HTTP/SSE server with OAuth and Express endpoints.
 */
if (!process.stdin.isTTY) {
  await import('./stdio.js');
} else {
  await import('./server.js');
}
