# Adding a tool

1. Add a strict input schema in `src/server.js`.
2. Keep policy and deterministic logic in a focused module, not in the MCP handler.
3. Inject effects such as subprocess, filesystem, clock, or identifiers.
4. Return bounded structured output and a text rendering of the same payload.
5. Add tests for invariants, limits, and failure modes.

## Checklist

- validate untrusted input before running subprocesses
- use fixed executable names and trusted argument arrays
- keep stdout reserved for MCP protocol messages
- add comments near load-bearing guards
- document limitations honestly
