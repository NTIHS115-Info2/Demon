const ERROR_CODES = {
  SCAN_FAILED: "SCAN_FAILED",
  SCAN_DIR_FAILED: "SCAN_DIR_FAILED",
  SPEC_NOT_FOUND: "SPEC_NOT_FOUND",
  SPEC_PARSE_FAILED: "SPEC_PARSE_FAILED",
  INVALID_SPEC: "INVALID_SPEC",
  REGISTER_FAILED: "REGISTER_FAILED",
  DUPLICATE_PLUGIN_ID: "DUPLICATE_PLUGIN_ID",
  PLUGIN_ID_MISMATCH: "PLUGIN_ID_MISMATCH",
};

class PluginsManagerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "PluginsManagerError";
    this.code = code;
    this.details = details || null;
  }
}

const createError = (code, message, details) => new PluginsManagerError(code, message, details);

module.exports = {
  ERROR_CODES,
  PluginsManagerError,
  createError,
};
