const local = require('./local');
const remote = require('./remote');
const server = require('./server');

// 匯出各策略實作，提供給插件選擇
module.exports = {
  local,
  remote,
  server
};
