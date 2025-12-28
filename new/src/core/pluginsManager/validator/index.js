// new/src/core/pluginsManager/validator/index.js
let AjvCtor;
try {
  // Ajv v8 才通常有這個（draft 2020-12）
  AjvCtor = require("ajv/dist/2020");
} catch (e) {
  // fallback：兼容 Ajv v6/v7/v8 的 CommonJS 匯出
  const ajvPkg = require("ajv");
  AjvCtor = ajvPkg.default ?? ajvPkg;
}

const schema = require("../schema/PluginSpecSchema");
const ajv = new AjvCtor({ allErrors: true, strict: false });

const validate = ajv.compile(schema);

const formatAjvErrors = (errors) => {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => {
    const path = error.instancePath
      ? error.instancePath.replace(/\//g, ".").replace(/^\./, "")
      : "(root)";
    const message = error.message || "invalid";
    return `${path}: ${message}`;
  });
};

const validatePluginSpec = (pluginSpec) => {
  const valid = validate(pluginSpec);
  if (valid) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: formatAjvErrors(validate.errors) };
};

module.exports = {
  validatePluginSpec,
};
