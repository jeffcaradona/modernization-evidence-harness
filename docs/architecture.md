# Architecture

## Functional core, imperative shell

The harness keeps deterministic policy in small modules:

- `src/filesystem/safe-reader.js`: path validation, sensitive-path checks, bounded reads.
- `src/repositories/repository-service.js`: revision pinning, inventory/search/excerpt orchestration, evidence creation.
- `src/evidence/evidence.js`: stable evidence identity and deterministic ordering.
- `src/artifacts/reference-validator.js`: manifest parsing and evidence or Toolkit reference validation.

Effects stay at the edges:

- `src/index.js` owns stdio transport startup.
- `src/subprocess/runner.js` owns subprocess lifecycle, timeouts, and cancellation.
- `src/config.js` owns local configuration loading.

## Request flow

1. VS Code launches the Node.js process over stdio.
2. `src/index.js` loads config and constructs the MCP server.
3. A tool handler validates its schema and delegates to deterministic services.
4. Repository service verifies the pinned committed revision before and after collection.
5. Evidence is redacted, normalized, cataloged, and returned with bounded metadata.

## Trust boundaries

Untrusted inputs:

- repository file content
- file paths from tool arguments
- ripgrep search strings
- artifact manifests written by Copilot

Trusted inputs:

- operator-approved repository aliases and roots
- optional department Toolkit files selected by the department
- process environment needed to start the local server

## Load-bearing invariants

- Evidence identity keeps repository alias and commit SHA so duplicate paths across repositories remain distinguishable.
- Sanitized copies are returned to Copilot, but subprocesses execute validated original arguments so redaction never changes the search itself.
- Source repositories are read-only in milestone one; artifact output must be configured outside those roots.
- Session reference validation only proves that a reference points to recorded evidence, not that the interpretation is correct.

## Limitations

- Inventory and search are lexical only.
- `search_repository` depends on `rg` and returns a dependency error if it is missing.
- Session evidence catalog state is in-memory only.
- Toolkit validation is pending when no Toolkit index is configured.
