// === 段落說明：匯入日誌工具與行事曆伺服器工廠 ===
const Logger = require('../../../../utils/logger');
const { getCalendarServer } = require('../../../../../Server/calendar');

// === 段落說明：建立策略層級記錄器 ===
const logger = new Logger('calendarSystem-local');

// === 段落說明：初始化伺服器實例與設定儲存區 ===
let serverInstance = null;
let serverFactory = getCalendarServer;
let lastOptions = {};

// === 段落說明：定義預設行事曆名稱與工具函式 ===
const DEFAULT_CALENDAR_NAME = 'default';

// === 段落說明：驗證字串參數是否有效 ===
const ensureNonEmptyString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} 必須為非空白字串`);
  }
  return value.trim();
};

// === 段落說明：標準化可選擇提供的字串參數 ===
const normalizeOptionalString = (value, fieldName) => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value === null) {
    throw new Error(`${fieldName} 不可為 null`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必須為字串`);
  }
  return value.trim();
};

// === 段落說明：解析 YYYY-MM-DD 字串並產出當天起訖時間 ===
const parseDateOnly = dateStr => {
  const value = ensureNonEmptyString(dateStr, '日期參數');
  const parts = value.split('-');
  if (parts.length !== 3) {
    throw new Error('日期必須為 YYYY-MM-DD 格式');
  }

  const [yearStr, monthStr, dayStr] = parts;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('日期必須為有效的數字');
  }

  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('日期無法轉換為有效的 UTC 時間');
  }

  return { start, end };
};

// === 段落說明：從資料物件中取出主要參數來源，支援 params 與 payload ===
const resolveParams = (data = {}, fallback = {}) => {
  if (data && typeof data === 'object') {
    if (data.params && typeof data.params === 'object') {
      return data.params;
    }
    if (data.payload && typeof data.payload === 'object') {
      return data.payload;
    }
  }
  return fallback;
};

// === 段落說明：驗證 ISO8601 日期時間字串並回傳標準化值 ===
const normalizeISODateTime = (value, fieldName) => {
  const source = ensureNonEmptyString(value, fieldName);
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} 必須為有效的 ISO 8601 字串`);
  }
  return parsed.toISOString();
};

// === 段落說明：建立新增事件所需的標準化資料 ===
const buildCreatePayload = (params = {}) => {
  if (!params || typeof params !== 'object') {
    throw new Error('createEvent 參數必須為物件');
  }

  const rawTitle = typeof params.title !== 'undefined' ? params.title : params.summary;
  const title = ensureNonEmptyString(rawTitle, 'title');
  const rawStart = typeof params.startTime !== 'undefined' ? params.startTime : params.startISO;
  const rawEnd = typeof params.endTime !== 'undefined' ? params.endTime : params.endISO;
  if (typeof rawStart === 'undefined') {
    throw new Error('startTime 為必要欄位');
  }
  if (typeof rawEnd === 'undefined') {
    throw new Error('endTime 為必要欄位');
  }
  const startISO = normalizeISODateTime(rawStart, 'startTime');
  const endISO = normalizeISODateTime(rawEnd, 'endTime');

  if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
    throw new Error('endTime 必須晚於 startTime');
  }

  const payload = { ...params };

  payload.calendarName = ensureNonEmptyString(
    params.calendarName || lastOptions.defaultCalendarName || DEFAULT_CALENDAR_NAME,
    'calendarName'
  );
  payload.summary = title;
  payload.startISO = startISO;
  payload.endISO = endISO;

  const location = normalizeOptionalString(params.location, 'location');
  if (typeof location !== 'undefined') {
    payload.location = location;
  } else if (!Object.prototype.hasOwnProperty.call(params, 'location')) {
    delete payload.location;
  }

  const description = normalizeOptionalString(params.description, 'description');
  if (typeof description !== 'undefined') {
    payload.description = description;
  } else if (!Object.prototype.hasOwnProperty.call(params, 'description')) {
    delete payload.description;
  }

  return payload;
};

// === 段落說明：建構查詢事件列表的篩選條件 ===
const buildListFilters = (params = {}) => {
  if (!params || typeof params !== 'object') {
    throw new Error('listEvents 參數必須為物件');
  }

  const filters = {};
  const { date, from, to, rangeStart, rangeEnd, calendarName, includeDeleted } = params;

  if (calendarName) {
    filters.calendarName = ensureNonEmptyString(calendarName, 'calendarName');
  }

  if (typeof includeDeleted !== 'undefined') {
    filters.includeDeleted = Boolean(includeDeleted);
  }

  if (date && (from || to || rangeStart || rangeEnd)) {
    throw new Error('listEvents 不能同時設定 date 與範圍參數');
  }

  if (rangeStart || rangeEnd) {
    if (rangeStart) {
      filters.rangeStart = normalizeISODateTime(rangeStart, 'rangeStart');
    }
    if (rangeEnd) {
      filters.rangeEnd = normalizeISODateTime(rangeEnd, 'rangeEnd');
    }
  } else if (date) {
    const { start, end } = parseDateOnly(date);
    filters.rangeStart = start.toISOString();
    filters.rangeEnd = end.toISOString();
  } else {
    if (from) {
      const { start } = parseDateOnly(from);
      filters.rangeStart = start.toISOString();
    }
    if (to) {
      const { end } = parseDateOnly(to);
      filters.rangeEnd = end.toISOString();
    }
  }

  return filters;
};

// === 段落說明：建立更新事件所需的 uid 與部分欄位 ===
const buildUpdatePayload = (data = {}) => {
  const params = { ...resolveParams(data) };
  if (typeof params.uid === 'undefined' && typeof data.uid !== 'undefined') {
    params.uid = data.uid;
  }

  if (!params || typeof params !== 'object') {
    throw new Error('update 參數必須為物件');
  }

  const uid = ensureNonEmptyString(params.uid, 'uid');
  const patch = { ...params };
  delete patch.uid;

  const hasOwn = key => Object.prototype.hasOwnProperty.call(params, key);

  if (hasOwn('title') || hasOwn('summary')) {
    const rawTitle = hasOwn('title') ? params.title : params.summary;
    patch.summary = ensureNonEmptyString(rawTitle, 'title');
  }

  if (hasOwn('description')) {
    const description = normalizeOptionalString(params.description, 'description');
    if (typeof description !== 'undefined') {
      patch.description = description;
    } else {
      delete patch.description;
    }
  }

  if (hasOwn('location')) {
    const location = normalizeOptionalString(params.location, 'location');
    if (typeof location !== 'undefined') {
      patch.location = location;
    } else {
      delete patch.location;
    }
  }

  if (hasOwn('startTime') || hasOwn('startISO')) {
    const rawStart = hasOwn('startTime') ? params.startTime : params.startISO;
    const start = new Date(rawStart);
    if (Number.isNaN(start.getTime())) {
      throw new Error('startTime 必須為有效的 ISO 8601 字串');
    }
    patch.startISO = start.toISOString();
  }

  if (hasOwn('endTime') || hasOwn('endISO')) {
    const rawEnd = hasOwn('endTime') ? params.endTime : params.endISO;
    const end = new Date(rawEnd);
    if (Number.isNaN(end.getTime())) {
      throw new Error('endTime 必須為有效的 ISO 8601 字串');
    }
    patch.endISO = end.toISOString();
  }

  if (hasOwn('calendarName')) {
    patch.calendarName = ensureNonEmptyString(params.calendarName, 'calendarName');
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('update 至少需要一個可更新欄位');
  }

  return { uid, patch };
};

// === 段落說明：整理刪除事件所需參數並支援舊欄位 ===
const buildDeleteOptions = (data = {}) => {
  const params = resolveParams(data);
  const legacyOptions = data && typeof data.options === 'object' && data.options ? data.options : {};
  const uid = ensureNonEmptyString((params && params.uid) || data.uid, 'uid');
  let softSource;
  if (params && Object.prototype.hasOwnProperty.call(params, 'soft')) {
    softSource = params.soft;
  } else if (legacyOptions && Object.prototype.hasOwnProperty.call(legacyOptions, 'soft')) {
    softSource = legacyOptions.soft;
  } else if (Object.prototype.hasOwnProperty.call(data, 'soft')) {
    softSource = data.soft;
  }

  const options = {};
  if (typeof softSource !== 'undefined') {
    options.soft = Boolean(softSource);
  }

  return { uid, options };
};

// === 段落說明：整理讀取單筆事件的參數 ===
const buildReadParams = (data = {}) => {
  const params = resolveParams(data);
  const uidCandidate = (params && params.uid) || data.uid;
  return { uid: ensureNonEmptyString(uidCandidate, 'uid') };
};

// === 段落說明：整理同步命令的參數 ===
const buildSyncParams = (data = {}) => {
  const fallbackOptions = data && typeof data.options === 'object' && data.options ? data.options : {};
  const params = resolveParams(data, fallbackOptions);
  const typeCandidate = params && params.type ? params.type : fallbackOptions.type;
  const type = typeof typeCandidate === 'string' ? typeCandidate : undefined;
  return type === 'full' ? 'full' : 'incremental';
};

const priority = 0;

// === 段落說明：定義舊版指令集合以處理相容行為 ===
const LEGACY_ACTIONS = new Set(['create', 'update', 'delete', 'read', 'list', 'push', 'status']);

// === 段落說明：更新伺服器工廠與設定以便測試或客製化 ===
const configure = (options = {}) => {
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
    if (lastOptions.defaultCalendarName) {
      lastOptions.defaultCalendarName = ensureNonEmptyString(
        lastOptions.defaultCalendarName,
        'defaultCalendarName'
      );
    }
  } catch (err) {
    const message = `calendarSystem 本地策略配置失敗：${err.message}`;
    logger.error(message);
    throw new Error(message);
  }
};

module.exports = {
  // === 段落說明：宣告本地策略的預設優先度 ===
  priority,

  // === 段落說明：提供策略設定介面給外部模組呼叫 ===
  configure,

  // === 段落說明：啟動本地行事曆伺服器 ===
  async online(options = {}) {
    configure(options);
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

    let action = 'unknown';
    try {
      if (!data || typeof data !== 'object') {
        throw new Error('指令資料必須為物件');
      }

      action = ensureNonEmptyString(data.action, 'action');
      const params = resolveParams(data, {});

      switch (action) {
        case 'createEvent': {
          const payload = buildCreatePayload(params);
          const record = await serverInstance.createEvent(payload);
          return { success: true, resultType: 'event', result: record };
        }
        case 'listEvents': {
          const filters = buildListFilters(params || {});
          const items = await serverInstance.listEvents(filters);
          return { success: true, resultType: 'eventList', result: items };
        }
        case 'create': {
          const payload = buildCreatePayload(params);
          return serverInstance.createEvent(payload);
        }
        case 'update': {
          const { uid, patch } = buildUpdatePayload(data);
          return serverInstance.updateEvent(uid, patch);
        }
        case 'delete': {
          const { uid, options } = buildDeleteOptions(data);
          return serverInstance.deleteEvent(uid, options);
        }
        case 'read': {
          const { uid } = buildReadParams(data);
          return serverInstance.readEvent(uid);
        }
        case 'list': {
          const legacyOptions = typeof data.options === 'object' && data.options ? data.options : {};
          const combined = { ...legacyOptions, ...(params || {}) };
          const filters = buildListFilters(combined);
          return serverInstance.listEvents(filters);
        }
        case 'push': {
          const type = buildSyncParams(data);
          return serverInstance.triggerSync(type);
        }
        case 'status': {
          return serverInstance.getStatus();
        }
        default:
          throw new Error(`不支援的 calendarSystem 指令：${action}`);
      }
    } catch (err) {
      const handledError = err instanceof Error ? err : new Error(String(err));
      const message = `calendarSystem 本地策略處理指令失敗：${handledError.message}`;
      logger.error(message);
      if (LEGACY_ACTIONS.has(action)) {
        throw handledError;
      }
      return { success: false, resultType: 'error', error: message, value: { details: handledError.message } };
    }
  },
};
