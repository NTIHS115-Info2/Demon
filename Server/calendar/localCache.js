// === 段落說明：引入所需模組以建立本地事件快取 ===
const { EventEmitter } = require('events');
const crypto = require('crypto');

// === 段落說明：建立簡易的時間工具以避免依賴外部函式庫 ===
function toISO(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    throw new Error('提供的日期格式無法轉換為有效的 ISO 字串');
  }
  return date.toISOString();
}

// === 段落說明：定義本地事件快取類別，負責 CRUD 與狀態維護 ===
class LocalCalendarCache extends EventEmitter {
  constructor({ logger, nowProvider } = {}) {
    super();
    // === 段落說明：初始化紀錄器與時間提供者以利除錯與測試 ===
    this.logger = logger;
    this.nowProvider = typeof nowProvider === 'function' ? nowProvider : () => new Date();

    // === 段落說明：建立儲存結構與索引以支援快速查詢 ===
    this.events = new Map();
    this.syncToken = null;
    this.fullSyncCursor = null;
  }

  // === 段落說明：生成 UID，優先使用 crypto.randomUUID，失敗時退回自訂方案 ===
  generateUid() {
    try {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return crypto.randomBytes(16).toString('hex');
    } catch (err) {
      const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (this.logger) this.logger.warn(`生成 UID 發生錯誤，改用備援方案：${err.message}`);
      return fallback;
    }
  }

  // === 段落說明：檢查事件資料結構並回傳標準化結果 ===
  normalizeEvent(payload, { allowPartial = false } = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('事件資料必須為物件');
    }

    const requiredFields = ['calendarName', 'summary', 'startISO', 'endISO'];
    if (!allowPartial) {
      requiredFields.forEach(key => {
        if (!payload[key]) {
          throw new Error(`事件缺少必要欄位：${key}`);
        }
      });
    }

    const normalized = {
      uid: payload.uid || this.generateUid(),
      metadata:
        payload && payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? { ...payload.metadata }
          : {},
    };

    const hasField = key => Object.prototype.hasOwnProperty.call(payload, key);

    if (hasField('calendarName')) {
      normalized.calendarName = payload.calendarName;
    } else if (!allowPartial) {
      normalized.calendarName = payload.calendarName;
    }

    if (hasField('summary')) {
      normalized.summary = payload.summary;
    } else if (!allowPartial) {
      normalized.summary = payload.summary;
    }

    if (hasField('description')) {
      normalized.description = payload.description || '';
    } else if (!allowPartial) {
      normalized.description = '';
    }

    if (hasField('location')) {
      normalized.location = payload.location || '';
    } else if (!allowPartial) {
      normalized.location = '';
    }

    if (hasField('attendees')) {
      normalized.attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
    } else if (!allowPartial) {
      normalized.attendees = [];
    }

    if (hasField('reminders')) {
      normalized.reminders = Array.isArray(payload.reminders) ? payload.reminders : [];
    } else if (!allowPartial) {
      normalized.reminders = [];
    }

    if (hasField('recurrenceRule')) {
      normalized.recurrenceRule = payload.recurrenceRule || null;
    } else if (!allowPartial) {
      normalized.recurrenceRule = null;
    }

    if (hasField('startISO')) {
      normalized.startISO = toISO(payload.startISO);
    } else if (!allowPartial) {
      normalized.startISO = toISO(payload.startISO);
    }

    if (hasField('endISO')) {
      normalized.endISO = toISO(payload.endISO);
    } else if (!allowPartial) {
      normalized.endISO = toISO(payload.endISO);
    }

    return normalized;
  }

  // === 段落說明：取得事件紀錄，若不存在則回傳 null ===
  getEvent(uid) {
    return this.events.get(uid) || null;
  }

  // === 段落說明：建立事件並紀錄狀態，包含錯誤處理與事件廣播 ===
  createEvent(payload) {
    try {
      const event = this.normalizeEvent(payload);
      if (this.events.has(event.uid)) {
        throw new Error(`事件 UID 重複：${event.uid}`);
      }

      const nowISO = toISO(this.nowProvider());
      const record = {
        event,
        version: 1,
        etag: payload.etag || null,
        url: payload.url || null,
        lastModified: nowISO,
        status: 'created',
        locked: false,
      };

      this.events.set(event.uid, record);
      this.emit('created', { ...record });
      return { ...record };
    } catch (err) {
      if (this.logger) this.logger.error(`建立事件失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：更新事件內容並自動遞增版本 ===
  updateEvent(uid, patch) {
    const record = this.events.get(uid);
    if (!record) {
      throw new Error(`找不到指定事件：${uid}`);
    }
    if (record.locked) {
      throw new Error(`事件 ${uid} 處於鎖定狀態，無法更新`);
    }

    try {
      const updated = this.normalizeEvent({ ...record.event, ...patch, uid }, { allowPartial: true });
      const nowISO = toISO(this.nowProvider());
      const nextRecord = {
        ...record,
        event: { ...record.event, ...updated },
        version: record.version + 1,
        lastModified: nowISO,
        status: patch.status || 'updated',
        etag: patch.etag !== undefined ? patch.etag : record.etag,
        url: patch.url !== undefined ? patch.url : record.url,
      };

      this.events.set(uid, nextRecord);
      this.emit('updated', { ...nextRecord });
      return { ...nextRecord };
    } catch (err) {
      if (this.logger) this.logger.error(`更新事件 ${uid} 失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：刪除事件並保留最後狀態資訊 ===
  deleteEvent(uid, { soft = false } = {}) {
    const record = this.events.get(uid);
    if (!record) {
      throw new Error(`找不到指定事件：${uid}`);
    }
    if (record.locked) {
      throw new Error(`事件 ${uid} 處於鎖定狀態，無法刪除`);
    }

    if (soft) {
      const nowISO = toISO(this.nowProvider());
      const nextRecord = {
        ...record,
        status: 'deleted',
        lastModified: nowISO,
      };
      this.events.set(uid, nextRecord);
      this.emit('deleted', { ...nextRecord });
      return { ...nextRecord };
    }

    this.events.delete(uid);
    this.emit('removed', { uid, reason: 'hard-delete' });
    return { uid, removed: true };
  }

  // === 段落說明：依據時間範圍與行事曆名稱篩選事件 ===
  listEvents({ calendarName, rangeStart, rangeEnd, includeDeleted = false } = {}) {
    const startTime = rangeStart ? new Date(rangeStart).getTime() : null;
    const endTime = rangeEnd ? new Date(rangeEnd).getTime() : null;

    const items = [];
    for (const record of this.events.values()) {
      if (!includeDeleted && record.status === 'deleted') {
        continue;
      }
      if (calendarName && record.event.calendarName !== calendarName) {
        continue;
      }

      const eventStart = new Date(record.event.startISO).getTime();
      const eventEnd = new Date(record.event.endISO).getTime();

      if (startTime !== null && eventEnd < startTime) continue;
      if (endTime !== null && eventStart > endTime) continue;

      items.push({ ...record });
    }
    return items;
  }

  // === 段落說明：標記事件鎖定或解除鎖定 ===
  setLock(uid, locked) {
    const record = this.events.get(uid);
    if (!record) {
      throw new Error(`找不到指定事件：${uid}`);
    }

    const nextRecord = { ...record, locked: Boolean(locked) };
    this.events.set(uid, nextRecord);
    this.emit('locked', { uid, locked: Boolean(locked) });
    return { ...nextRecord };
  }

  // === 段落說明：整批套用遠端同步結果，用於全量或增量同步 ===
  applyRemoteSnapshot(remoteEvents = []) {
    if (!Array.isArray(remoteEvents)) {
      throw new Error('遠端同步資料必須為陣列');
    }

    const results = [];
    for (const remote of remoteEvents) {
      if (!remote || !remote.event) {
        if (this.logger) this.logger.warn('跳過格式錯誤的遠端事件資料');
        continue;
      }

      const existing = this.events.get(remote.event.uid);
      if (!existing) {
        const created = this.createEvent({ ...remote.event });
        const synced = this.updateEvent(created.event.uid, {
          ...remote.event,
          status: remote.status || 'synced',
          etag: remote.etag,
          url: remote.url,
          lastModified: remote.lastModified,
        });
        results.push(synced);
        continue;
      }

      if (existing.lastModified && remote.lastModified && new Date(existing.lastModified) > new Date(remote.lastModified)) {
        results.push({ ...existing, skipped: true });
        continue;
      }

      const updated = this.updateEvent(remote.event.uid, {
        ...remote.event,
        status: remote.status || 'synced',
        etag: remote.etag,
        url: remote.url,
        lastModified: remote.lastModified,
      });
      results.push(updated);
    }
    return results;
  }

  // === 段落說明：管理 sync-token 與全量同步游標 ===
  setSyncToken(token) {
    this.syncToken = token || null;
    return this.syncToken;
  }

  getSyncToken() {
    return this.syncToken;
  }

  setFullSyncCursor(cursor) {
    this.fullSyncCursor = cursor || null;
    return this.fullSyncCursor;
  }

  getFullSyncCursor() {
    return this.fullSyncCursor;
  }
}

// === 段落說明：輸出本地快取類別供其他模組使用 ===
module.exports = LocalCalendarCache;
