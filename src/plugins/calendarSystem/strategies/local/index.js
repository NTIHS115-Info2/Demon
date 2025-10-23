// === 段落說明：匯入日誌工具與行事曆伺服器工廠 ===
const Logger = require('../../../../utils/logger');
const { getCalendarServer } = require('../../../../../Server/calendar');

// === 段落說明：建立策略層級記錄器 ===
const logger = new Logger('calendarSystem-local');

// === 段落說明：初始化伺服器實例與設定儲存區 ===
let serverInstance = null;
let serverFactory = getCalendarServer;
let lastOptions = {};

const priority = 0,

module.exports = {
  // === 段落說明：宣告本地策略的預設優先度 ===
  priority,

  // === 段落說明：更新伺服器工廠與設定以便測試或客製化 ===
  configure(options = {}) {
    try {
      const hasCustomFactory = Object.prototype.hasOwnProperty.call(options, 'serverFactory');
      if (hasCustomFactory) {
        if (typeof options.serverFactory === 'function') {
          serverFactory = options.serverFactory;
        } else if (options.serverFactory === null) {
          serverFactory = getCalendarServer;
        } else {
          throw new Error('提供的 serverFactory 不是可呼叫的函式');
        }
      }
      lastOptions = options.serverOptions ? { ...options.serverOptions } : {};
    } catch (err) {
      const message = `calendarSystem 本地策略配置失敗：${err.message}`;
      logger.error(message);
      throw new Error(message);
    }
  },

  // === 段落說明：啟動本地行事曆伺服器 ===
  async online(options = {}) {
    this.configure(options);
    if (serverInstance) {
      logger.warn('calendarSystem 本地策略已啟動，略過重複啟動請求');
      return;
    }

    try {
      serverInstance = serverFactory({ ...lastOptions });
      await serverInstance.start();
      logger.info('calendarSystem 本地策略伺服器已上線');
    } catch (err) {
      serverInstance = null;
      const message = `calendarSystem 本地策略啟動失敗：${err.message}`;
      logger.error(message);
      throw new Error(message);
    }
  },

  // === 段落說明：關閉伺服器並清除快取 ===
  async offline() {
    if (!serverInstance) {
      logger.warn('calendarSystem 本地策略尚未啟動，略過離線流程');
      return;
    }

    try {
      await serverInstance.stop();
      logger.info('calendarSystem 本地策略伺服器已離線');
    } catch (err) {
      const message = `calendarSystem 本地策略離線失敗：${err.message}`;
      logger.error(message);
      throw new Error(message);
    } finally {
      serverInstance = null;
    }
  },

  // === 段落說明：重新啟動伺服器以套用新設定 ===
  async restart(options = {}) {
    await this.offline();
    await this.online(options);
  },

  // === 段落說明：回報目前伺服器狀態 ===
  async state() {
    if (!serverInstance) {
      return 0;
    }

    try {
      const status = await serverInstance.getStatus();
      return status && status.started ? 1 : 0;
    } catch (err) {
      logger.error(`calendarSystem 本地策略取得狀態失敗：${err.message}`);
      return -1;
    }
  },

  // === 段落說明：接收指令並透過伺服器執行 ===
  async send(data = {}) {
    if (!serverInstance) {
      throw new Error('calendarSystem 本地策略尚未啟動');
    }

    const { action, payload, uid, options = {} } = data;
    try {
      switch (action) {
        case 'create':
          return await serverInstance.createEvent(payload);
        case 'update':
          return await serverInstance.updateEvent(uid, payload);
        case 'delete':
          return await serverInstance.deleteEvent(uid, options);
        case 'read':
          return await serverInstance.readEvent(uid);
        case 'list':
          return await serverInstance.listEvents(options);
        case 'push':
          return await serverInstance.triggerSync(options.type || 'incremental');
        case 'status':
          return await serverInstance.getStatus();
        default:
          throw new Error(`不支援的 calendarSystem 指令：${action}`);
      }
    } catch (err) {
      const message = `calendarSystem 本地策略處理指令失敗：${err.message}`;
      logger.error(message);
      throw new Error(message);
    }
  },
};
