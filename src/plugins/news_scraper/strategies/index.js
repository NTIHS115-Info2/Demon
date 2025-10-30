// src/plugins/news_scraper/strategies/index.js
// 目的：統一導出所有策略，方便未來擴展
module.exports = {
    local: require('./local'),
    // remote: require('./remote'), // 為未來擴展預留
};
