# Registry Specification (Phase 1)

## Manifest and Schema

- Manifest path: `plugins/<pluginId>/plugin.json`
- Schema: `src/core/pluginsManager/schema/PluginSpecSchema.js` (JSON Schema 2020-12)

## Registration Flow

1. Validate manifest against schema.
2. Apply folder name policy (see below).
3. Register by `spec.id` as the canonical plugin id.

## folderNameMustMatchSpecId Policy

Default: `true`

- When `true`, if `plugins/<folderName>/plugin.json` has `id != <folderName>`, reject with
  `PLUGIN_ID_MISMATCH`. Error details must include `folderName` and `specId`.
- When `false`, allow registration but log a warning once. Registry still uses `spec.id` as
  the canonical id.

## getStrategiesByCapability Output Contract

`getStrategiesByCapability(capability)` returns an array of candidates with the minimum shape:

```
{
  pluginId,
  pluginVersion,
  pluginRoot,
  strategyId,
  executor,
  priority,
  effectiveCapabilities
}
```

- `effectiveCapabilities` is `strategy.capabilities` when provided, otherwise `plugin.capabilities`.
- Candidates must be immutable and must not share object references with the internal registry.
