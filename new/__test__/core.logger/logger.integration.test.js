const fs = require('fs');
const path = require('path');

const LOG_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const LINE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - INFO - /;

function createBasePath() {
  const baseRoot = path.join(__dirname, 'logs_test');
  const basePath = path.join(
    baseRoot,
    `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(basePath, { recursive: true });
  return basePath;
}

function loadLogger(basePath) {
  jest.resetModules();
  const config = require('../../src/core/logger/config');
  config.setBaseLogPath(basePath);
  const Logger = require('../../src/core/logger');
  const registry = require('../../src/core/logger/core/registry');
  return { Logger, registry };
}

function closeStreams(registry) {
  const pool = registry.getStreamPool();
  if (!pool || !pool.streamMap) return;
  for (const stream of pool.streamMap.values()) {
    if (!stream) continue;
    if (stream.destroyed || stream.writableEnded) continue;
    if (typeof stream.end === 'function') {
      stream.end();
    }
    if (typeof stream.destroy === 'function') {
      stream.destroy();
    }
  }
  pool.streamMap.clear();
}

function cleanupPath(basePath) {
  if (fs.existsSync(basePath)) {
    fs.rmSync(basePath, { recursive: true, force: true });
  }
}

test('logger integration: session + handlers + stream pool', async () => {
  const basePath = createBasePath();
  const { Logger, registry } = loadLogger(basePath);
  const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream');
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  Logger.SetConsoleLog(true);
  const loggerA = new Logger('main');
  const loggerB = new Logger('main');
  loggerA.info('hello world');
  loggerB.info('hello again');

  expect(createWriteStreamSpy).toHaveBeenCalledTimes(1);

  const pool = registry.getStreamPool();
  const stream = pool.streamMap.get('main.log');
  await new Promise((resolve) => {
    if (!stream) {
      resolve();
      return;
    }
    stream.end(resolve);
  });
  if (stream && typeof stream.destroy === 'function') {
    stream.destroy();
  }

  const dirEntries = fs.readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  expect(dirEntries.length).toBe(1);

  const runDirName = dirEntries[0].name;
  expect(LOG_DIR_PATTERN.test(runDirName)).toBe(true);

  const runDirPath = path.join(basePath, runDirName);
  const logFilePath = path.join(runDirPath, 'main.log');
  expect(fs.existsSync(logFilePath)).toBe(true);

  const lines = fs.readFileSync(logFilePath, 'utf8')
    .trim()
    .split(/\r?\n/);
  const sampleLine = lines[0];
  expect(LINE_PATTERN.test(sampleLine)).toBe(true);
  expect(sampleLine.endsWith('hello world')).toBe(true);

  expect(consoleLogSpy.mock.calls.some((call) => String(call[0]).includes('hello world')))
    .toBe(true);

  process.stdout.write(`找到 log 檔路徑: ${logFilePath}\n`);
  process.stdout.write(`比對到的範例行: ${sampleLine}\n`);

  Logger.SetConsoleLog(false);
  consoleLogSpy.mockRestore();
  createWriteStreamSpy.mockRestore();
  closeStreams(registry);
  cleanupPath(basePath);
});
