// src/plugins/news_scraper/index.js

const LocalStrategy = require('./strategies/local/index.js');

// 插件的狀態和策略實例
let currentState = -2; // -2: state 未定義
let strategy = null;

// [V1.0.0-fix] 導出一個直接包含所有方法的物件
module.exports = {
  // 初始化時，由 PluginsManager 傳入 options
  init: function(options) {
    strategy = new LocalStrategy(options);
    currentState = 0; // 0: 初始化完成，處於下線狀態
    console.log("NewsScraperPlugin (v1.0.0) 已初始化，當前為離線狀態。");
  },

  online: async function(option) {
    console.log("NewsScraperPlugin 收到上線指令...");
    currentState = 1; // 1: 上線
    console.log("NewsScraperPlugin 已成功上線。");
    return true; // 根據測試框架要求，返回一個值
  },

  offline: async function() {
    console.log("NewsScraperPlugin 收到下線指令...");
    currentState = 0; // 0: 下線
    console.log("NewsScraperPlugin 已成功下線。");
  },

  state: async function() {
    return currentState;
  },

  send: async function(payload) {
    if (currentState !== 1) {
      const errorMsg = "插件未上線，無法處理請求。";
      console.error(errorMsg);
      return { success: false, error: errorMsg };
    }
    if (!strategy) {
      const errorMsg = "策略未初始化，無法處理請求。";
      console.error(errorMsg);
      return { success: false, error: errorMsg };
    }
    console.log("NewsScraperPlugin 正在將 'send' 指令轉發給策略...");
    return strategy.send(payload);
  },

  updateStrategy: async function(option) {
    console.log("updateStrategy 功能尚未實現。");
    return { success: false, error: "Not implemented." };
  }
};