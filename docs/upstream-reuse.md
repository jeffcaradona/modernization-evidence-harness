# Upstream reuse

- **Upstream URL**: https://github.com/jeffcaradona/local-llm-assurance-harness
- **Inspected commit**: `e77ce1e8f8c0a5e77f0dcf6012e0fa1698807cf5`
- **License**: MIT

## Modules considered

- `src/filesystem/collector.js`
- `src/subprocess/runner.js`
- `src/redaction.js`
- `src/errors.js`
- `src/capabilities/registry.js`
- tests for collectors, capabilities, and runner behavior

## Reuse decisions

### Reuse unchanged concepts

- bounded subprocess execution with `shell: false`
- stable executable-not-found and timeout errors
- explicit redaction metadata
- root containment, symlink rejection, and bounded reads

### Adapt for this milestone

- filesystem collection was split into safer excerpt-reading and repository-service orchestration for MCP tools
- capability allowlisting became fixed tool schemas for `legacy-a` and `legacy-b`
- collector-style tests were adapted to synthetic Git-backed legacy repositories and MCP stdio tests

### Leave behind

- model provider admission and replay
- review-specific orchestration and schema validation
- internal LLM loops and prompt construction
- original CLI review commands

## Relevant tests brought forward

- bounded subprocess output and missing executable mapping
- malformed search output handling
- symlink escape blocking
- traversal and option-injection blocking
- deterministic ordering and redaction behavior

## Known limitations and local adaptations

- the upstream project explicitly deferred MCP transport, so this repository adds stdio MCP composition locally
- `fd` inventory ideas were considered, but milestone one uses committed Git inventory for pinned snapshots
- the session evidence catalog is memory-only for now

## Attribution obligations

The upstream repository is MIT licensed. This repository must keep the MIT license notice and retain attribution for adapted concepts and copied structure where applicable.
