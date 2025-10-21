// === 段落說明：匯入路徑、檔案與日誌工具以管理密鑰載入流程 ===
const path = require('path');
const fs = require('fs');
const Logger = require('../../../src/utils/logger');

// === 段落說明：建立密鑰專用記錄器以追蹤載入狀態與錯誤 ===
const logger = new Logger('calendar-secrets.log');

// === 段落說明：使用快取避免重複讀取機敏檔案 ===
let cachedSecrets = null;

// === 段落說明：集中計算 tokens/icloud.js 實際路徑 ===
function resolveTokenPath() {
  const tokenPath = path.resolve(__dirname, '../../../tokens/icloud.js');
  return tokenPath;
}

// === 段落說明：以 CommonJS require 載入密鑰模組並確保檔案存在 ===
function loadTokenModule() {
  const tokenPath = resolveTokenPath();
  if (!fs.existsSync(tokenPath)) {
    const message = '找不到 tokens/icloud.js，請依照 tokens/README.md 建立憑證檔案';
    logger.error(message);
    throw new Error(message);
  }

  try {
    // === 段落說明：直接使用 require 以符合 CommonJS 規範 ===
    const resolvedPath = require.resolve(tokenPath);
    delete require.cache[resolvedPath];
    const moduleContent = require(resolvedPath);
    return moduleContent;
  } catch (err) {
    const message = `載入 tokens/icloud.js 失敗：${err.message}`;
    logger.error(message);
    throw new Error(message);
  }
}

// === 段落說明：檢查密鑰模組是否包含必要欄位並整理輸出 ===
function normalizeSecrets(rawModule) {
  const secretsSource = rawModule && rawModule.default ? rawModule.default : rawModule;
  if (!secretsSource || typeof secretsSource !== 'object') {
    const message = 'tokens/icloud.js 格式錯誤，請輸出物件或 CommonJS 匯出';
    logger.error(message);
    throw new Error(message);
  }

  const requiredFields = ['ICLOUD_USER', 'ICLOUD_APP_PASSWORD', 'ICLOUD_CAL_NAME'];
  const missing = requiredFields.filter((field) => !secretsSource[field]);
  if (missing.length > 0) {
    const message = `tokens/icloud.js 缺少必要欄位：${missing.join(', ')}`;
    logger.error(message);
    throw new Error(message);
  }

  return {
    ICLOUD_USER: String(secretsSource.ICLOUD_USER),
    ICLOUD_APP_PASSWORD: String(secretsSource.ICLOUD_APP_PASSWORD),
    ICLOUD_CAL_NAME: String(secretsSource.ICLOUD_CAL_NAME),
    TIMEZONE: secretsSource.TIMEZONE ? String(secretsSource.TIMEZONE) : 'UTC',
    SYNC_INTERVAL_MINUTES: Number.isFinite(secretsSource.SYNC_INTERVAL_MINUTES)
      ? secretsSource.SYNC_INTERVAL_MINUTES
      : 1,
  };
}

// === 段落說明：提供外部取得密鑰的主要介面並搭配錯誤處理 ===
function getSecrets() {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const moduleContent = loadTokenModule();
  cachedSecrets = normalizeSecrets(moduleContent);
  return cachedSecrets;
}

// === 段落說明：釋出重新整理快取的工具，以便於動態更新憑證 ===
function refreshSecrets() {
  cachedSecrets = null;
  return getSecrets();
}

// === 段落說明：輸出取得與刷新密鑰的函式 ===
module.exports = {
  getSecrets,
  refreshSecrets,
};
