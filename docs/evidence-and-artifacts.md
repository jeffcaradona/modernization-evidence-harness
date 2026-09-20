# Evidence and artifacts

## Evidence contract

Each evidence item includes:

- stable `evidenceId`
- repository alias
- pinned commit SHA
- relative path
- line range
- analysis method
- source hash
- bounded sanitized excerpt
- truncation and redaction metadata

Analysis labels used in milestone one:

- `Direct source observation`
- `Lexical candidate`

## Artifact structure

Use Markdown plus a JSON reference manifest.

```text
artifacts/
  inventory/
  workflows/
  requirements/
  decisions/
  design/
  open-questions/
```

Sample templates live under `templates/artifacts`.

## Validation scope

`validate_artifact_references` checks:

- that each evidence reference exists in the current session catalog
- that the referenced source hash matches the recorded evidence
- that each Toolkit reference exists in the configured Toolkit index and matches the recorded document hash

Validation returns explicit independent states for:

- `referenceIntegrity`
- `semanticCorrectness`
- `departmentApproval`

Only `referenceIntegrity` is evaluated by the harness. It does **not** prove business correctness, and it does **not** manufacture department approval.

## Toolkit mapping

If no department Toolkit is configured, mark conformance as pending instead of inventing rules.
