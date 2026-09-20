# Security and limitations

## Security controls

- repository aliases are fixed to `legacy-a` and `legacy-b`
- paths are relative and validated against traversal, option injection, and symlink escape
- sensitive paths such as `.env`, key files, and appsettings secrets are excluded
- subprocesses use `shell: false` and bounded stdout/stderr
- cancellation stops owned subprocess work
- artifact validation trusts the in-memory session catalog rather than model-supplied evidence records

## Limitations

- redaction is pattern-based and cannot guarantee complete secret removal
- search is lexical only and does not provide a call graph or semantic resolution
- session evidence does not persist across process restarts
- revision pinning depends on prepared committed checkouts and detects drift; it does not create an atomic filesystem snapshot
- evidence returned to Copilot enters Copilot's configured processing environment
