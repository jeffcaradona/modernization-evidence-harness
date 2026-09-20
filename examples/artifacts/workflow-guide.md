# Synthetic workflow guide

1. Initialize the server with approved `legacy-a` and `legacy-b` committed checkouts.
2. Run `inventory_solution` for each repository alias.
3. Run `search_repository` for `SubmitOrder` and follow with `read_source_excerpt` on the returned paths.
4. Draft workflow, requirement, decision, design, and open-question artifacts in the artifact output root.
5. Run `validate_artifact_references` on each artifact manifest.
