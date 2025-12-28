const { scanPluginsDir } = require("./scanner");
const { validatePluginSpec } = require("./validator");
const { PluginsRegistry, createRegistry } = require("./registry");
const { ERROR_CODES, PluginsManagerError } = require("./errors");
const { getPolicy, setFolderNameMustMatchSpecId } = require("./config");

module.exports = {
  scanPluginsDir,
  validatePluginSpec,
  PluginsRegistry,
  createRegistry,
  ERROR_CODES,
  PluginsManagerError,
  getPolicy,
  setFolderNameMustMatchSpecId,
};
