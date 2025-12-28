const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const { ERROR_CODES } = require("../errors");

const scanPluginsDir = (pluginsDir) => {
  const result = { plugins: [], errors: [] };
  let entries = [];

  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[pluginsManager] scan dir failed for ${pluginsDir}: ${message}`);
    result.errors.push({
      code: ERROR_CODES.SCAN_DIR_FAILED,
      message,
      pluginsDir,
    });
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginId = entry.name;
    const pluginRoot = path.join(pluginsDir, pluginId);
    const specPath = path.join(pluginRoot, "plugin.json");

    if (!fs.existsSync(specPath)) {
      logger.warn(`[pluginsManager] missing plugin.json at ${specPath}`);
      result.errors.push({
        code: ERROR_CODES.SPEC_NOT_FOUND,
        message: "plugin.json not found",
        pluginId,
        pluginRoot,
        manifestPath: specPath,
      });
      continue;
    }

    try {
      const raw = fs.readFileSync(specPath, "utf-8");
      const spec = JSON.parse(raw);
      result.plugins.push({
        pluginId,
        pluginRoot,
        specPath,
        spec,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[pluginsManager] failed to parse ${specPath}: ${message}`);
      result.errors.push({
        code: ERROR_CODES.SPEC_PARSE_FAILED,
        message,
        pluginId,
        pluginRoot,
        manifestPath: specPath,
      });
    }
  }

  return result;
};

module.exports = {
  scanPluginsDir,
};
