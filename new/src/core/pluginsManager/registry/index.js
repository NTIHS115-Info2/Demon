const path = require("path");
const logger = require("../logger");
const { ERROR_CODES, createError } = require("../errors");
const { validatePluginSpec } = require("../validator");
const { getPolicy } = require("../config");

const freezeDeep = (value) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = value[key];
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      freezeDeep(child);
    }
  }
  return value;
};

class PluginsRegistry {
  constructor() {
    this.plugins = new Map();
    this.warnedIdMismatch = new Set();
  }

  register(pluginSpec, pluginRoot) {
    const { valid, errors } = validatePluginSpec(pluginSpec);
    if (!valid) {
      const error = createError(ERROR_CODES.INVALID_SPEC, "invalid plugin spec", {
        errors,
        pluginId: pluginSpec && pluginSpec.id ? pluginSpec.id : null,
        pluginRoot,
      });
      logger.warn(
        `[pluginsManager] rejected plugin spec from ${pluginRoot || "unknown"}: ${errors.join(
          "; "
        )}`
      );
      throw error;
    }

    const pluginId = pluginSpec.id;
    const folderName = pluginRoot ? path.basename(pluginRoot) : null;
    if (folderName && pluginId && folderName !== pluginId) {
      const policy = getPolicy();
      if (policy.folderNameMustMatchSpecId) {
        const error = createError(
          ERROR_CODES.PLUGIN_ID_MISMATCH,
          "plugin folder name does not match spec id",
          {
            folderName,
            specId: pluginId,
            pluginRoot,
          }
        );
        logger.warn(
          `[pluginsManager] plugin id mismatch: folder=${folderName} spec.id=${pluginId}`
        );
        throw error;
      }
      const warnKey = `${folderName}:${pluginId}:${pluginRoot || ""}`;
      if (!this.warnedIdMismatch.has(warnKey)) {
        this.warnedIdMismatch.add(warnKey);
        logger.warn(
          `[pluginsManager] folder name does not match spec.id (allowed): folder=${folderName} spec.id=${pluginId}`
        );
      }
    }

    if (this.plugins.has(pluginId)) {
      const error = createError(ERROR_CODES.DUPLICATE_PLUGIN_ID, "duplicate plugin id", {
        pluginId,
      });
      logger.warn(`[pluginsManager] duplicate plugin id rejected: ${pluginId}`);
      throw error;
    }

    const entry = {
      id: pluginId,
      root: pluginRoot,
      spec: pluginSpec,
    };

    this.plugins.set(pluginId, entry);
    logger.info(`[pluginsManager] registered plugin ${pluginId}`);
    return entry;
  }

  getPlugin(pluginId) {
    return this.plugins.get(pluginId) || null;
  }

  listPlugins() {
    return Array.from(this.plugins.values());
  }

  listCapabilities() {
    const capabilities = new Set();
    for (const entry of this.plugins.values()) {
      const strategies = Array.isArray(entry.spec.strategies) ? entry.spec.strategies : [];
      for (const strategy of strategies) {
        const strategyCapabilities = Array.isArray(strategy.capabilities)
          ? strategy.capabilities
          : entry.spec.capabilities;
        if (!Array.isArray(strategyCapabilities)) continue;
        for (const capability of strategyCapabilities) {
          capabilities.add(capability);
        }
      }
    }
    return Array.from(capabilities);
  }

  getStrategiesByCapability(capability) {
    if (typeof capability !== "string" || capability.length === 0) {
      return [];
    }

    const matches = [];
    for (const entry of this.plugins.values()) {
      const strategies = Array.isArray(entry.spec.strategies) ? entry.spec.strategies : [];
      for (const strategy of strategies) {
        const strategyCapabilities = Array.isArray(strategy.capabilities)
          ? strategy.capabilities
          : entry.spec.capabilities;
        if (!Array.isArray(strategyCapabilities)) continue;
        if (!strategyCapabilities.includes(capability)) continue;
        const candidate = {
          pluginId: entry.id,
          pluginVersion: entry.spec.version || null,
          pluginRoot: entry.root || null,
          strategyId: strategy.id,
          executor: strategy.executor,
          priority: strategy.priority,
          effectiveCapabilities: strategyCapabilities.slice(),
        };
        matches.push(freezeDeep(candidate));
      }
    }
    return matches;
  }
}

const createRegistry = () => new PluginsRegistry();

module.exports = {
  PluginsRegistry,
  createRegistry,
};
