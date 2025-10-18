// === 段落說明：引入所需模組並建立 CalDAV 客戶端支援 ===
const { EventEmitter } = require('events');
const Logger = require('../../src/utils/logger');
const { getSecrets } = require('./config/secrets');

// === 段落說明：定義 CalDAV 客戶端，涵蓋實際與模擬兩種執行模式 ===
class CalDavClient extends EventEmitter {
  constructor(options = {}) {
    super();

    // === 段落說明：初始化記錄器與依賴檢查 ===
    this.logger = options.logger || new Logger('calendar-caldav-client.log');
    this.mode = 'mock';
    this.dependencies = {};
    this.remoteEvents = new Map();
    this.syncToken = null;

    // === 段落說明：嘗試載入外部套件，若失敗則進入模擬模式 ===
    this.bootstrapDependencies();

    // === 段落說明：設定密鑰與時區資訊，缺失時透過紀錄器提示 ===
    this.secrets = options.secrets || getSecrets();
    if (!this.secrets.ICLOUD_USER || !this.secrets.ICLOUD_APP_PASSWORD) {
      this.logger.warn('未提供 iCloud 憑證，本模組將維持模擬模式。');
      this.mode = 'mock';
    }

    // === 段落說明：在真實模式下初始化 CalDAV 帳號資訊 ===
    this.accountPromise = null;
    if (this.mode === 'live') {
      this.accountPromise = this.initializeAccount();
    }
  }

  // === 段落說明：載入外部套件並決定執行模式 ===
  bootstrapDependencies() {
    try {
      this.dependencies.dav = require('dav');
      this.dependencies.ical = require('ical-generator');
      this.dependencies.luxon = require('luxon');
      this.mode = 'live';
    } catch (err) {
      this.logger.warn(`載入 CalDAV 相關套件失敗，使用模擬模式：${err.message}`);
      this.mode = 'mock';
    }
  }

  // === 段落說明：建立 CalDAV 帳號連線，並具備錯誤處理 ===
  async initializeAccount() {
    if (this.mode !== 'live') return null;

    const { dav } = this.dependencies;
    const credentials = new dav.Credentials({
      username: this.secrets.ICLOUD_USER,
      password: this.secrets.ICLOUD_APP_PASSWORD,
    });

    try {
      const account = await dav.createAccount({
        server: 'https://caldav.icloud.com',
        credentials,
        loadCollections: true,
        loadObjects: true,
      });
      this.logger.info('成功連線至 iCloud CalDAV。');
      return account;
    } catch (err) {
      this.logger.error(`連線 iCloud CalDAV 失敗：${err.message}`);
      this.mode = 'mock';
      return null;
    }
  }

  // === 段落說明：取得遠端帳號資訊，若尚未初始化則重新嘗試 ===
  async getAccount() {
    if (this.mode !== 'live') {
      throw new Error('目前執行於模擬模式，無法取得 CalDAV 帳號');
    }
    if (!this.accountPromise) {
      this.accountPromise = this.initializeAccount();
    }
    return this.accountPromise;
  }

  // === 段落說明：列出遠端事件，支援增量與全量同步 ===
  async listRemoteEvents({ windowStart, windowEnd, syncToken } = {}) {
    if (this.mode === 'mock') {
      return this.listMockEvents({ windowStart, windowEnd, syncToken });
    }

    try {
      const { DateTime } = this.dependencies.luxon;
      const account = await this.getAccount();
      if (!account) {
        throw new Error('CalDAV 帳號尚未初始化');
      }

      const calendar = account.calendars.find(item => item.displayName === this.secrets.ICLOUD_CAL_NAME) || account.calendars[0];
      if (!calendar) {
        throw new Error('找不到對應的 iCloud 行事曆');
      }

      const params = {};
      if (windowStart || windowEnd) {
        params.timeRange = {
          start: windowStart ? DateTime.fromISO(windowStart).toJSDate() : undefined,
          end: windowEnd ? DateTime.fromISO(windowEnd).toJSDate() : undefined,
        };
      }
      if (syncToken) params.syncToken = syncToken;

      const objects = await this.dependencies.dav.listCalendarObjects(calendar, params);
      const results = objects.map(obj => ({
        event: this.parseICalObject(obj),
        etag: obj.etag,
        url: obj.url,
        lastModified: obj.lastmodified || obj.data.lastmodified || new Date().toISOString(),
        status: 'synced',
      }));
      this.syncToken = calendar.syncToken || syncToken || null;
      return results;
    } catch (err) {
      this.logger.error(`讀取遠端事件失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：解析 iCal 物件為內部統一格式 ===
  parseICalObject(obj) {
    try {
      // Use node-ical to parse the ICS string
      const ical = this.dependencies['node-ical'] || require('node-ical');
      const parsed = ical.parseICS(obj.data);
      // Find the first VEVENT in the parsed object
      const eventKey = Object.keys(parsed).find(key => parsed[key].type === 'VEVENT');
      if (!eventKey) {
        throw new Error('No VEVENT found in ICS data');
      }
      const event = parsed[eventKey];
      return {
        uid: event.uid,
        calendarName: this.secrets.ICLOUD_CAL_NAME,
        summary: event.summary,
        description: event.description,
        location: event.location,
        startISO: event.start ? new Date(event.start).toISOString() : null,
        endISO: event.end ? new Date(event.end).toISOString() : null,
        attendees: event.attendee ? (Array.isArray(event.attendee) ? event.attendee : [event.attendee]) : [],
        reminders: event.alarms || [],
      };
    } catch (err) {
      this.logger.error(`解析 iCal 事件失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：模擬模式下的事件列表實作 ===
  async listMockEvents({ windowStart, windowEnd } = {}) {
    const results = [];
    const start = windowStart ? new Date(windowStart).getTime() : null;
    const end = windowEnd ? new Date(windowEnd).getTime() : null;

    for (const record of this.remoteEvents.values()) {
      const eventStart = new Date(record.event.startISO).getTime();
      const eventEnd = new Date(record.event.endISO).getTime();
      if (start !== null && eventEnd < start) continue;
      if (end !== null && eventStart > end) continue;
      results.push({ ...record });
    }
    return results;
  }

  // === 段落說明：在模擬模式下新增事件 ===
  async createMockEvent(record) {
    this.remoteEvents.set(record.event.uid, { ...record, status: 'synced' });
    return { ...record, status: 'synced' };
  }

  // === 段落說明：在模擬模式下更新事件 ===
  async updateMockEvent(record) {
    this.remoteEvents.set(record.event.uid, { ...record, status: 'synced' });
    return { ...record, status: 'synced' };
  }

  // === 段落說明：在模擬模式下刪除事件 ===
  async deleteMockEvent(uid) {
    this.remoteEvents.delete(uid);
    return { uid };
  }

  // === 段落說明：統一建立或更新遠端事件 ===
  async upsertRemoteEvent(record) {
    if (this.mode === 'mock') {
      const existed = this.remoteEvents.has(record.event.uid);
      return existed ? this.updateMockEvent(record) : this.createMockEvent(record);
    }

    try {
      const account = await this.getAccount();
      const calendar = account.calendars.find(item => item.displayName === this.secrets.ICLOUD_CAL_NAME) || account.calendars[0];
      if (!calendar) {
        throw new Error('找不到對應的 iCloud 行事曆');
      }

      const ical = this.dependencies.ical({ name: this.secrets.ICLOUD_CAL_NAME });
      const event = ical.createEvent({
        uid: record.event.uid,
        start: new Date(record.event.startISO),
        end: new Date(record.event.endISO),
        summary: record.event.summary,
        description: record.event.description,
        location: record.event.location,
      });
      if (record.event.attendees && record.event.attendees.length) {
        record.event.attendees.forEach(att => event.createAttendee(att));
      }
      await this.dependencies.dav.createCalendarObject(calendar, {
        filename: `${record.event.uid}.ics`,
        data: ical.toString(),
      });
      return { ...record, status: 'synced' };
    } catch (err) {
      this.logger.error(`上傳遠端事件失敗：${err.message}`);
      throw err;
    }
  }

  // === 段落說明：刪除遠端事件 ===
  async deleteRemoteEvent(uid) {
    if (this.mode === 'mock') {
      return this.deleteMockEvent(uid);
    }

    try {
      const account = await this.getAccount();
      const calendar = account.calendars.find(item => item.displayName === this.secrets.ICLOUD_CAL_NAME) || account.calendars[0];
      const target = calendar.objects.find(obj => obj.calendarData.includes(uid));
      if (!target) {
        this.logger.warn(`遠端事件 ${uid} 不存在，視為成功刪除`);
        return { uid };
      }
      await this.dependencies.dav.deleteCalendarObject(target);
      return { uid };
    } catch (err) {
      this.logger.error(`刪除遠端事件失敗：${err.message}`);
      throw err;
    }
  }
}

// === 段落說明：輸出 CalDavClient 類別供伺服器組件使用 ===
module.exports = CalDavClient;
