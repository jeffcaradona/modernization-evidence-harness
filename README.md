# modernization-evidence-harness

`modernization-evidence-harness` is a local MCP server for GitHub Copilot Chat in VS Code. It performs deterministic, read-only evidence collection across two operator-approved VB.NET repository roots (`legacy-a` and `legacy-b`) so Copilot can draft requirements and replacement designs for **Modernized Node.js Applications**.

## Milestone summary

1. **Upstream reuse decisions**: adapt bounded filesystem reads, subprocess execution, redaction, and stable error handling from `jeffcaradona/local-llm-assurance-harness`; leave behind model-provider, replay, and review orchestration code.
2. **Runtime and dependencies**: Node.js 22 LTS+, native ESM, `@modelcontextprotocol/sdk`, and `zod`.
3. **Module boundaries**: deterministic policy/core logic lives in `src/repositories`, `src/filesystem`, `src/evidence`, and `src/artifacts`; effects are isolated in `src/index.js`, Git/subprocess execution, and config loading.
4. **Trust and resource ownership**: repository content, paths, search strings, and tool arguments are untrusted; only configured roots and optional department Toolkit files are trusted inputs.
5. **First implementation milestone**: stdio MCP server with four tools, source snapshot pinning, evidence cataloging, artifact reference validation, synthetic fixtures, and deterministic tests.

## What this server does

- Uses stdio MCP transport only.
- Pins each approved repository alias to a committed Git revision at session initialization.
- Inventories tracked files, runs fixed-string repository search, reads bounded excerpts, and validates artifact references.
- Returns evidence with stable identity, repository alias, commit SHA, path, line range, analysis label, source hash, redaction metadata, and truncation metadata.
- Keeps MCP protocol traffic on stdout and diagnostics on stderr.

## What this server does not do

- It does **not** host a local LLM.
- It does **not** call a model provider API.
- It does **not** approve requirements automatically.
- It does **not** execute, build, or modify the legacy repositories.
- It does **not** guarantee local-only inference; evidence returned to Copilot enters Copilot's configured processing environment.

## Install

```powershell
npm install
```

Supported baseline: Node.js `>=22.0.0 <25`.

External command requirements:

- `git` for committed snapshot identity.
- `rg` for `search_repository`.

If `rg` is unavailable, `search_repository` returns an actionable dependency error instead of silently substituting another search tool.

## Configure local paths

Copy `examples/config/harness.config.example.json` to a local ignored path such as `harness.config.local.json` and fill in absolute paths for:

- `legacy-a`
- `legacy-b`
- the artifact output root
- the optional department Toolkit root and index

The artifact output root must be outside both legacy roots.

## Connect from VS Code

1. Copy `examples/config/vscode.mcp.json` into your local VS Code MCP settings.
2. Set `MODERNIZATION_EVIDENCE_HARNESS_CONFIG` to your absolute local config file.
3. Start Copilot Chat and connect the local MCP server.

## Tools

### `inventory_solution`
Returns a bounded lexical inventory of committed tracked files for one repository alias.

### `search_repository`
Runs `rg --fixed-strings` against one repository alias and returns **Lexical candidate** evidence.

### `read_source_excerpt`
Reads a bounded excerpt and returns **Direct source observation** evidence.

### `validate_artifact_references`
Checks artifact manifests against evidence actually returned in the current session catalog and against configured Toolkit references.

## Synthetic example

The repository includes synthetic VB.NET examples under `/home/runner/work/modernization-evidence-harness/modernization-evidence-harness/examples/synthetic` plus sample artifact templates under `/home/runner/work/modernization-evidence-harness/modernization-evidence-harness/templates/artifacts`.

## Test

```powershell
npm test
```

## Exact next commands

```powershell
npm install
$env:MODERNIZATION_EVIDENCE_HARNESS_CONFIG = "C:\absolute\path\to\harness.config.local.json"
node .\src\index.js
npm test
```
