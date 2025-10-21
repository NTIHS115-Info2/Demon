// === 段落說明：引入事件工具以構建同步工作排程 ===
const { EventEmitter } = require('events');

// === 段落說明：定義同步工作者，負責定時調度與錯誤處理 ===
class SyncWorker extends EventEmitter {
  constructor({ cache, caldavClient, logger, scheduler = global } = {}) {
    super();

    // === 段落說明：保存必要的依賴實例 ===
    this.cache = cache;
    this.caldavClient = caldavClient;
    this.logger = logger;

    // === 段落說明：設定排程相關參數與控制旗標 ===
    this.scheduler = scheduler;
    this.incrementalTimer = null;
    this.fullTimer = null;
    this.running = false;
    this.fullTimeout = null;
  }

  // === 段落說明：啟動同步排程，包括分鐘級與每日任務 ===
  start({ incrementalMinutes = 1, fullSyncHour = 0, fullSyncMinute = 0 } = {}) {
    if (this.running) {
      this.logger?.warn('同步工作者已啟動，忽略重複呼叫');
      return;
    }
    this.running = true;

    const incrementalMs = Math.max(incrementalMinutes, 1) * 60 * 1000;
    this.incrementalTimer = this.scheduler.setInterval(async () => {
      try {
        await this.runIncrementalSync();
      } catch (err) {
        this.logger?.error(`分鐘級同步失敗：${err.message}`);
      }
    }, incrementalMs);

    const scheduleFullSync = async () => {
      try {
        await this.runFullSync();
      } catch (err) {
        this.logger?.error(`全量同步失敗：${err.message}`);
      }
    };

    const now = new Date();
    const firstFull = new Date(now);
    firstFull.setUTCHours(fullSyncHour, fullSyncMinute, 0, 0);
    if (firstFull <= now) {
      firstFull.setUTCDate(firstFull.getUTCDate() + 1);
    }
    const initialDelay = firstFull.getTime() - now.getTime();
    this.fullTimeout = this.scheduler.setTimeout(scheduleFullSync, initialDelay);
    this.fullTimer = this.scheduler.setInterval(scheduleFullSync, 24 * 60 * 60 * 1000);
  }

  // === 段落說明：停止同步任務並清理資源 ===
  stop() {
    if (!this.running) return;
    if (this.incrementalTimer) this.scheduler.clearInterval(this.incrementalTimer);
    if (this.fullTimer) this.scheduler.clearInterval(this.fullTimer);
    if (this.fullTimeout) this.scheduler.clearTimeout(this.fullTimeout);
    this.running = false;
  }

  // === 段落說明：執行分鐘級增量同步，僅抓取未來一年資料 ===
  async runIncrementalSync() {
    const now = new Date();
    const windowStart = now.toISOString();
    const windowEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const remoteEvents = await this.caldavClient.listRemoteEvents({
        windowStart,
        windowEnd,
        syncToken: this.cache.getSyncToken(),
      });
      this.cache.applyRemoteSnapshot(remoteEvents);
      if (typeof this.cache.setSyncToken === 'function') {
        this.cache.setSyncToken(this.caldavClient.syncToken ?? null);
      }
      this.emit('incremental-synced', { count: remoteEvents.length });
    } catch (err) {
      this.logger?.error(`執行增量同步時發生錯誤：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：執行每日全量同步並重置快取狀態 ===
  async runFullSync() {
    try {
      const remoteEvents = await this.caldavClient.listRemoteEvents();
      const snapshot = Array.isArray(remoteEvents) ? remoteEvents : [];
      const remoteUids = new Set();

      for (const remote of snapshot) {
        const uid = remote?.event?.uid;
        if (uid) {
          remoteUids.add(uid);
        }
      }

      this.cache.applyRemoteSnapshot(snapshot);

      if (typeof this.cache.listEvents === 'function' && typeof this.cache.deleteEvent === 'function') {
        const localRecordsRaw = await Promise.resolve(this.cache.listEvents({ includeDeleted: true }));
        const localRecords = Array.isArray(localRecordsRaw) ? localRecordsRaw : [];

        for (const record of localRecords) {
          const uid = record?.event?.uid;
          if (!uid || remoteUids.has(uid)) {
            continue;
          }

          const isLocalOnly = !record.url && record.status !== 'deleted';
          if (isLocalOnly) {
            continue;
          }

          try {
            this.cache.deleteEvent(uid);
            this.logger?.info?.(`移除遠端快照中缺失的本地事件：${uid}`);
          } catch (deleteErr) {
            this.logger?.warn?.(`移除遠端快照中缺失的本地事件失敗：${uid} - ${deleteErr.message}`);
          }
        }
      }

      if (typeof this.cache.setSyncToken === 'function') {
        this.cache.setSyncToken(this.caldavClient.syncToken ?? null);
      }
      this.emit('full-synced', { count: snapshot.length });
    } catch (err) {
      this.logger?.error(`執行全量同步時發生錯誤：${err.message}`);
      throw err;
    }
  }
}

// === 段落說明：輸出同步工作者供伺服器呼叫 ===
module.exports = SyncWorker;
