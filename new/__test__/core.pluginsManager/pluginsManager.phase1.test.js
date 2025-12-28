const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  scanPluginsDir,
  createRegistry,
  validatePluginSpec,
  ERROR_CODES,
  setFolderNameMustMatchSpecId,
} = require("../../src/core/pluginsManager");
const logger = require("../../src/core/pluginsManager/logger");

const buildRequirements = () => ({
  platform: { os: ["win32"], arch: ["x64"] },
  runtime: { node: ">=20" },
  resources: { gpu: false },
  network: { requiresInternet: false, requiresLan: false },
  env: { required: [] },
  permissions: { fsRead: [], fsWrite: [], net: [], spawn: false },
});

const buildCost = () => ({
  startupMs: 0,
  latencyMsP50: 0,
  latencyMsP95: 0,
  memoryMB: 0,
  gpuMB: 0,
  stabilityRisk: 0,
});

const buildStrategy = (overrides = {}) => ({
  id: "default",
  executor: "in_process",
  entry: { module: "./index.js", export: "createPlugin" },
  priority: 50,
  requirements: buildRequirements(),
  cost: buildCost(),
  ...overrides,
});

const buildSpec = (overrides = {}) => ({
  apiVersion: "plugins.demon/v1",
  kind: "Plugin",
  id: "plugin-a",
  name: "Plugin A",
  version: "1.0.0",
  capabilities: ["llm.chat"],
  strategies: [buildStrategy()],
  ...overrides,
});

describe("pluginsManager phase1", () => {
  afterEach(() => {
    setFolderNameMustMatchSpecId(true);
    jest.restoreAllMocks();
  });

  test("schema validation loads correctly", () => {
    const result = validatePluginSpec(buildSpec());
    expect(result.valid).toBe(true);
  });

  test("scanner reports distinct error codes", () => {
    const missingDir = path.join(os.tmpdir(), `plugins-missing-${Date.now()}`);
    const missingScan = scanPluginsDir(missingDir);
    expect(missingScan.errors).toHaveLength(1);
    expect(missingScan.errors[0].code).toBe(ERROR_CODES.SCAN_DIR_FAILED);

    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-"));
    const missingRoot = path.join(baseDir, "missing-spec");
    const badRoot = path.join(baseDir, "bad-json");
    fs.mkdirSync(missingRoot, { recursive: true });
    fs.mkdirSync(badRoot, { recursive: true });
    fs.writeFileSync(path.join(badRoot, "plugin.json"), "{", "utf-8");

    const scan = scanPluginsDir(baseDir);
    const codes = scan.errors.map((err) => err.code);
    expect(codes).toContain(ERROR_CODES.SPEC_NOT_FOUND);
    expect(codes).toContain(ERROR_CODES.SPEC_PARSE_FAILED);

    const notFound = scan.errors.find((err) => err.code === ERROR_CODES.SPEC_NOT_FOUND);
    const parseFailed = scan.errors.find((err) => err.code === ERROR_CODES.SPEC_PARSE_FAILED);
    expect(notFound.manifestPath).toBeTruthy();
    expect(notFound.pluginRoot).toBeTruthy();
    expect(parseFailed.manifestPath).toBeTruthy();
    expect(parseFailed.pluginRoot).toBeTruthy();
  });

  test("registers two plugins successfully", () => {
    const registry = createRegistry();
    registry.register(
      buildSpec({ id: "plugin-a", name: "Plugin A" }),
      "root/plugin-a"
    );
    registry.register(
      buildSpec({
        id: "plugin-b",
        name: "Plugin B",
        capabilities: ["llm.embed"],
        strategies: [buildStrategy({ id: "embed", capabilities: ["llm.embed"] })],
      }),
      "root/plugin-b"
    );

    expect(registry.listPlugins()).toHaveLength(2);
    expect(registry.getPlugin("plugin-a")).toBeTruthy();
    expect(registry.getPlugin("plugin-b")).toBeTruthy();
  });

  test("rejects invalid plugin.json during registration", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-"));
    const pluginRoot = path.join(baseDir, "bad-plugin");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "plugin.json"),
      JSON.stringify({ apiVersion: "plugins.demon/v1" }),
      "utf-8"
    );

    const scan = scanPluginsDir(baseDir);
    expect(scan.plugins).toHaveLength(1);

    const registry = createRegistry();
    try {
      registry.register(scan.plugins[0].spec, scan.plugins[0].pluginRoot);
      throw new Error("expected registry to reject invalid spec");
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.INVALID_SPEC);
    }

    expect(registry.listPlugins()).toHaveLength(0);
  });

  test("folderNameMustMatchSpecId true rejects mismatch", () => {
    setFolderNameMustMatchSpecId(true);
    const registry = createRegistry();
    try {
      registry.register(buildSpec({ id: "plugin-a" }), "root/mismatch");
      throw new Error("expected mismatch to be rejected");
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.PLUGIN_ID_MISMATCH);
      expect(err.details.folderName).toBe("mismatch");
      expect(err.details.specId).toBe("plugin-a");
    }
  });

  test("folderNameMustMatchSpecId false allows mismatch with warning", () => {
    setFolderNameMustMatchSpecId(false);
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const registry = createRegistry();
    const entry = registry.register(buildSpec({ id: "plugin-a" }), "root/mismatch");
    expect(entry.id).toBe("plugin-a");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("getStrategiesByCapability respects strategy capabilities fallback", () => {
    const registry = createRegistry();
    registry.register(
      buildSpec({
        id: "plugin-a",
        name: "Plugin A",
        capabilities: ["llm.chat", "llm.embed"],
        strategies: [buildStrategy({ id: "main" })],
      }),
      "root/plugin-a"
    );
    registry.register(
      buildSpec({
        id: "plugin-b",
        name: "Plugin B",
        capabilities: ["llm.chat"],
        strategies: [buildStrategy({ id: "fast", capabilities: ["llm.chat"] })],
      }),
      "root/plugin-b"
    );

    const chat = registry
      .getStrategiesByCapability("llm.chat")
      .map((item) => `${item.pluginId}:${item.strategyId}`)
      .sort();
    expect(chat).toEqual(["plugin-a:main", "plugin-b:fast"]);

    const embed = registry.getStrategiesByCapability("llm.embed");
    expect(embed).toHaveLength(1);
    expect(embed[0].pluginId).toBe("plugin-a");
    expect(embed[0].strategyId).toBe("main");
  });

  test("registry candidates are immutable and do not pollute state", () => {
    const registry = createRegistry();
    registry.register(
      buildSpec({
        id: "plugin-a",
        name: "Plugin A",
        capabilities: ["llm.chat", "llm.embed"],
        strategies: [buildStrategy({ id: "main" })],
      }),
      "root/plugin-a"
    );

    const first = registry.getStrategiesByCapability("llm.chat");
    expect(first).toHaveLength(1);
    try {
      first[0].effectiveCapabilities.push("llm.mutate");
    } catch (err) {
      // frozen candidates may throw in strict mode
    }
    try {
      first[0].pluginId = "mutated";
    } catch (err) {
      // frozen candidates may throw in strict mode
    }

    const second = registry.getStrategiesByCapability("llm.chat");
    expect(second).toHaveLength(1);
    expect(second[0].pluginId).toBe("plugin-a");
    expect(second[0].effectiveCapabilities).toEqual(["llm.chat", "llm.embed"]);
  });
});
