// === 段落說明：引入相關模組組成本地行事曆伺服器 ===
const { EventEmitter } = require('events');
const Logger = require('../../src/utils/logger');
const LocalCalendarCache = require('./localCache');
const CalDavClient = require('./caldavClient');
const SyncWorker = require('./syncWorker');
const { getSecrets } = require('./config/secrets');

function cloneEvent(event = {}) {
  const cloned = { ...event };
  if (Array.isArray(event.attendees)) {
    cloned.attendees = [...event.attendees];
  }
  if (Array.isArray(event.reminders)) {
    cloned.reminders = [...event.reminders];
  }
  if (event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) {
    cloned.metadata = { ...event.metadata };
  }
  return cloned;
}

function cloneRecord(record) {
  if (!record) return null;
  const { event, ...rest } = record;
  return { ...rest, event: cloneEvent(event) };
}

// === 段落說明：建立本地行事曆伺服器類別，整合快取、同步與 API ===
class LocalCalendarServer extends EventEmitter {
  constructor(options = {}) {
    super();

    // === 段落說明：初始化各項核心組件與設定 ===
    this.logger = options.logger || new Logger('calendar-server.log');
    this.secrets = options.secrets || getSecrets();
    this.cache = options.cache || new LocalCalendarCache({ logger: this.logger });
    this.caldavClient = options.caldavClient || new CalDavClient({ logger: this.logger, secrets: this.secrets });
    this.syncWorker = options.syncWorker || new SyncWorker({ cache: this.cache, caldavClient: this.caldavClient, logger: this.logger });
    this.started = false;

    // === 段落說明：轉發快取事件以利觀測與除錯 ===
    this.cache.on('created', payload => this.emit('event-created', payload));
    this.cache.on('updated', payload => this.emit('event-updated', payload));
    this.cache.on('deleted', payload => this.emit('event-deleted', payload));
  }

  // === 段落說明：啟動伺服器並建立同步排程 ===
  async start() {
    if (this.started) {
      this.logger.warn('本地行事曆伺服器已啟動，略過重複操作');
      return;
    }
    try {
      this.syncWorker.start({ incrementalMinutes: this.secrets.SYNC_INTERVAL_MINUTES });
      this.started = true;
      this.logger.info('本地行事曆伺服器啟動完成');
    } catch (err) {
      this.started = false;
      this.logger.error(`啟動同步排程失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：停止伺服器與同步排程 ===
  async stop() {
    if (!this.started) return;
    this.syncWorker.stop();
    this.started = false;
    this.logger.info('本地行事曆伺服器已停止');
  }

  // === 段落說明：建立事件並推送至遠端 ===
  async createEvent(payload) {
    let record;
    try {
      record = this.cache.createEvent(payload);
      await this.caldavClient.upsertRemoteEvent(record);
      return record;
    } catch (err) {
      if (record && record.event && record.event.uid) {
        try {
          this.cache.deleteEvent(record.event.uid);
        } catch (rollbackErr) {
          this.logger.error(`回滾本地新增事件失敗：${rollbackErr.message}`);
        }
      }
      this.logger.error(`建立事件流程失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：更新事件內容並同步遠端 ===
  async updateEvent(uid, patch) {
    let previousSnapshot = null;
    let record = null;
    try {
      const existing = this.cache.getEvent(uid);
      previousSnapshot = existing ? cloneRecord(existing) : null;
      record = this.cache.updateEvent(uid, patch);
      await this.caldavClient.upsertRemoteEvent(record);
      return record;
    } catch (err) {
      if (record && previousSnapshot) {
        try {
          this.cache.restoreEventSnapshot(previousSnapshot);
        } catch (rollbackErr) {
          this.logger.error(`回滾事件 ${uid} 至前一版本失敗：${rollbackErr.message}`);
        }
      }
      this.logger.error(`更新事件流程失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：刪除事件並同步遠端 ===
  async deleteEvent(uid, options = {}) {
    const { soft = false } = options;

    try {
      if (soft) {
        return this.cache.deleteEvent(uid, { soft: true });
      }

      const existing = this.cache.getEvent(uid);
      if (!existing) {
        throw new Error(`找不到指定事件：${uid}`);
      }
      if (existing.locked) {
        throw new Error(`事件 ${uid} 處於鎖定狀態，無法刪除`);
      }

      await this.caldavClient.deleteRemoteEvent(uid);
      return this.cache.deleteEvent(uid);
    } catch (err) {
      this.logger.error(`刪除事件流程失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：讀取單一事件內容 ===
  async readEvent(uid) {
    const record = this.cache.getEvent(uid);
    if (!record) {
      throw new Error('事件不存在');
    }
    return record;
  }

  // === 段落說明：依條件列出事件 ===
  async listEvents(filters = {}) {
    return this.cache.listEvents(filters);
  }

  // === 段落說明：手動觸發增量或全量同步 ===
  async triggerSync(type = 'incremental') {
    if (type === 'full') {
      return this.syncWorker.runFullSync();
    }
    return this.syncWorker.runIncrementalSync();
  }

  // === 段落說明：查詢伺服器狀態摘要 ===
  async getStatus() {
    return {
      started: this.started,
      cacheSize: this.cache.events.size,
      syncToken: this.cache.getSyncToken(),
      remoteMode: this.caldavClient.mode,
    };
  }
}

// === 段落說明：建立單例工廠以共用伺服器實例 ===
let singleton = null;
function getCalendarServer(options = {}) {
  if (!singleton) {
    singleton = new LocalCalendarServer(options);
  }
  return singleton;
}

// === 段落說明：輸出伺服器類別與單例工廠 ===
module.exports = {
  LocalCalendarServer,
  getCalendarServer,
};
