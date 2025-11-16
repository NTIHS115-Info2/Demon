// === 段落說明：集中輸出行事曆伺服器模組 ===
const { LocalCalendarServer, getCalendarServer } = require('./server');

// === 段落說明：提供建立新伺服器的工廠方法 ===
function createCalendarServer(options = {}) {
  return new LocalCalendarServer(options);
}

// === 段落說明：輸出工廠與單例存取介面 ===
module.exports = {
  createCalendarServer,
  getCalendarServer,
  LocalCalendarServer,
};
