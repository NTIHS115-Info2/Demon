// src/plugins/news_scraper/index.js

const LocalStrategy = require('./strategies/local/index.js');

// 插件的狀態和策略實例
let currentState = -2; // -2: state 未定義
let strategy = null;
let pluginOptions = {}; // 用於儲存初始化選項

// [V1.0.0-fix] 導出一個直接包含所有方法的物件
module.exports = {
  // 初始化方法，由 PluginsManager 載入時調用
  init: function(options) {
    pluginOptions = options; // 保存選項供重啟使用
    strategy = new LocalStrategy(options);
    currentState = 0; // 0: 初始化完成，處於下線狀態
    console.log("NewsScraperPlugin (v1.0.0) 已初始化，當前為離線狀態。");
  },

  online: async function(option) {
    console.log("NewsScraperPlugin 收到上線指令...");
    currentState = 1; // 1: 上線
    console.log("NewsScraperPlugin 已成功上線。");
    return true;
  },

  offline: async function() {
    console.log("NewsScraperPlugin 收到下線指令...");
    currentState = 0; // 0: 下線
    console.log("NewsScraperPlugin 已成功下線。");
  },

  // [V1.0.0-fix] 新增缺失的 restart 方法
  restart: async function(option) {
    console.log("NewsScraperPlugin 收到重啟指令...");
    await this.offline();
    // 使用保存的選項重新初始化策略
    this.init(pluginOptions);
    await this.online(option);
    console.log("NewsScraperPlugin 已成功重啟。");
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