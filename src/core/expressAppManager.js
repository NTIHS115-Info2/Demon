const express = require('express');
const Logger = require('../utils/logger');

// 檔案用途：建立並管理主服務唯一的 Express 實例，提供插件注入與共享

// 建立記錄器，方便追蹤 Express 實例建立與注入行為
const logger = new Logger('expressAppManager');

// 模組層級狀態：保存唯一的 Express 實例，避免重複建立
let expressApp = null;

/**
 * 建立 Express 實例
 * @returns {Object} Express app
 */
function createExpressApp() {
  // 建立 Express app，主服務只會擁有一份實例
  const app = express();
  logger.info('[ExpressApp] 已建立全域 Express 實例');
  return app;
}

/**
 * 取得 Express 實例（若不存在則建立）
 * @returns {Object} Express app
 */
function getExpressApp() {
  // 確保只會建立一次 Express app
  if (!expressApp) {
    expressApp = createExpressApp();
  }
  return expressApp;
}

/**
 * 注入外部建立的 Express 實例
 * @param {Object} app - 外部 Express app
 * @returns {Object} 注入後的 Express app
 */
function setExpressApp(app) {
  // 基本檢查：避免注入無效物件
  if (!app || typeof app.use !== 'function') {
    throw new Error('Express app 注入失敗：無效的 app 物件');
  }
  expressApp = app;
  logger.info('[ExpressApp] 已注入外部 Express 實例');
  return expressApp;
}

module.exports = {
  getExpressApp,
  setExpressApp
};
