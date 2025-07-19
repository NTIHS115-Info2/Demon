const local = require('./local');
const remote = require('./remote');
const server = require('./server');

// 匯出三種策略以供插件載入
module.exports = {
  local,
  remote,
  server
};
