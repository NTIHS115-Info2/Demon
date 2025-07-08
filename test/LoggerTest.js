const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Logger = require('../src/core/logger.js');
const { SetLoggerBasePath } = require('../src/core/logger.js');

// 測試專用 basePath
const TEST_BASE = path.resolve(__dirname, '..' , 'logs' , 'tlogs');

// 1. 設定 basePath
SetLoggerBasePath(path.resolve(TEST_BASE));


// 2. 產生多個 logger 實例
const logA = new Logger('a.log');

console.log(`[Logger] ${logA.getLogPath()}`);

const logB = new Logger('b.log');
const defaultLog = new Logger(); // default.log

// 3. 呼叫各種等級方法
logA.info('這是一條 INFO 訊息');
logA.warn('這是一條 WARN 訊息');
logA.error('這是一條 ERROR 訊息');

logB.info('B 模組 INFO 測試');
defaultLog.error('Default 模組 ERROR 測試');

console.log('✔ Logger 全功能測試通過');
