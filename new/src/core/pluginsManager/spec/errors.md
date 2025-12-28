# pluginsManager Error Codes (Phase 1)

## Scanner

| Code | Description |
| --- | --- |
| SCAN_DIR_FAILED | Failed to read `pluginsDir` (e.g., missing or permission error). |
| SPEC_NOT_FOUND | `plugin.json` is missing in a plugin folder. |
| SPEC_PARSE_FAILED | `plugin.json` exists but JSON parsing failed. |

Scanner errors must include `pluginRoot` or `manifestPath` for traceability.

## Registry / Validation

| Code | Description |
| --- | --- |
| INVALID_SPEC | Manifest failed schema validation. |
| DUPLICATE_PLUGIN_ID | Duplicate `spec.id` was registered. |
| PLUGIN_ID_MISMATCH | `folderName` does not match `spec.id` when policy requires it. |

## Legacy

| Code | Description |
| --- | --- |
| SCAN_FAILED | Legacy generic scan error (superseded by specific scan codes). |
