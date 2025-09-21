// src/plugins/news_scraper/index.js

const LocalStrategy = require('./strategies/local/index.js');

class NewsScraperPlugin {
    constructor(options) {
        this.currentState = -2; // -2: state 未定義
        this.strategy = new LocalStrategy(options);
        this.currentState = 0; // 0: 初始化完成，處於下線狀態
        console.log("NewsScraperPlugin (v1.0.0) 已初始化，當前為離線狀態。");
    }

    // [V1.0.0-fix] 確保所有接口方法都被正確實現
    async online(option) {
        console.log("NewsScraperPlugin 收到上線指令...");
        this.currentState = 1; // 1: 上線
        console.log("NewsScraperPlugin 已成功上線。");
    }

    async offline() {
        console.log("NewsScraperPlugin 收到下線指令...");
        this.currentState = 0; // 0: 下線
        console.log("NewsScraperPlugin 已成功下線。");
    }

    async state() {
        return this.currentState;
    }

    async send(payload) {
        if (this.currentState !== 1) {
            const errorMsg = "插件未上線，無法處理請求。";
            console.error(errorMsg);
            return { success: false, error: errorMsg };
        }
        console.log("NewsScraperPlugin 正在將 'send' 指令轉發給策略...");
        return this.strategy.send(payload);
    }

    async updateStrategy(option) {
        console.log("updateStrategy 功能尚未實現。");
        return { success: false, error: "Not implemented." };
    }
}

module.exports = NewsScraperPlugin;