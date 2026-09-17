/** Install before loading runtime dependencies. MCP stdio stdout is protocol-only;
 * console diagnostics must never create malformed JSON-RPC frames. */
export function installStdioLogGuard(): void {
  const stderr = console.error.bind(console);
  console.log = (...args: unknown[]): void => { stderr(...args); };
  console.info = (...args: unknown[]): void => { stderr(...args); };
  console.debug = (...args: unknown[]): void => { stderr(...args); };
  console.warn = (...args: unknown[]): void => { stderr(...args); };
}
