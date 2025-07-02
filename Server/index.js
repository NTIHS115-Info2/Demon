const axios = require('axios');
const si = require('systeminformation');
const desktopIdle = require('desktop-idle');

const LlamaServerManager = require('./llama/llamaServer.js');
const Logger = require('../src/core/logger.js');

setInterval(() => {
  const idleTime = desktopIdle.getIdleTime(); // 秒數
  if (idleTime > 2) {
    console.log('🟡 使用者閒置中');
  } else {
    console.log('🟢 使用者活躍');
  }
}, 100);