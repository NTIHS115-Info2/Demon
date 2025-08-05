// __tests__/Logger.test.js

const fs = require('fs');
const path = require('path');
const Logger = require('../../src/utils/logger');
const SetLoggerBasePath = require('../../src/utils/logger').SetLoggerBasePath;

describe('Logger 模組功能', () => {
  // 使用相對路徑建立測試用 log 目錄
  const LOG_DIR = path.join('logs', 'tlogs');
  beforeAll(() => {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    SetLoggerBasePath(LOG_DIR);
    expect(fs.existsSync(LOG_DIR)).toBe(true);
  });

  test('getLogPath 應回傳以 base path 為開頭的動態子資料夾', () => {
    const logA = new Logger('a.log');
    const p = logA.getLogPath();
    // 只要以 LOG_DIR 開頭即可
    expect(p.startsWith(LOG_DIR)).toBe(true);

    // 若要更精確，也可以驗證子資料夾名稱符合 ISO 毫秒格式：
    const subfolder = path.basename(p);
    // 例如：2025-07-12T07-22-42-291Z
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(subfolder)).toBe(true);
  });

  test('info, warn, error 不會拋錯', () => {
    const logB = new Logger('b.log');
    expect(() => logB.info('測試 INFO')).not.toThrow();
    expect(() => logB.warn('測試 WARN')).not.toThrow();
    expect(() => logB.error('測試 ERROR')).not.toThrow();
  });
});
