const local = require('./local');
const remote = require('./remote');
const server = require('./server');

// 將三種策略集中導出，供管理器選擇
module.exports = {
  local,
  remote,
  server
};
