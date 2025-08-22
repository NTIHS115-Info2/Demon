const local = require('./local');

// 匯出可用策略，僅保留本地實作
// 若未來擴充其他策略，可於此檔案新增引用
module.exports = {
  local
};
