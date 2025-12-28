class Logger {
  constructor(options = {}) {
    const {
      name,
      handlers = [],
      filterSensitiveInfo,
      lineFormatter,
      rawFormatter,
      baseMeta = null,
    } = options;

    this.name = name || 'default';
    this.handlers = handlers;
    this.filterSensitiveInfo = filterSensitiveInfo;
    this.lineFormatter = lineFormatter;
    this.rawFormatter = rawFormatter;
    this.baseMeta = baseMeta;
  }

  dispatch(record) {
    this.handlers.forEach((handler) => {
      if (handler && typeof handler.emit === 'function') {
        handler.emit(record);
      }
    });
  }

  createRecord(level, message, meta, options = {}) {
    const timestamp = new Date().toISOString();
    const messageText = typeof message === 'string' ? message : String(message);
    const isRaw = !!options.isRaw;
    const isOriginal = !!options.isOriginal;

    let filteredMessage = messageText;
    if (!isRaw && this.filterSensitiveInfo) {
      filteredMessage = this.filterSensitiveInfo(messageText);
    }

    let line;
    if (isRaw) {
      line = this.rawFormatter.format(level, messageText, timestamp);
    } else {
      line = this.lineFormatter.format(level, filteredMessage, timestamp);
    }

    let consoleMethod = 'log';
    if (level === 'WARN') {
      consoleMethod = 'warn';
    } else if (level === 'ERROR') {
      consoleMethod = 'error';
    }

    let consoleLine = line;
    if (isOriginal) {
      consoleLine = filteredMessage;
      consoleMethod = 'log';
    } else if (isRaw) {
      consoleLine = `[RAW] ${messageText}`;
      consoleMethod = 'log';
    }

    return {
      ts: timestamp,
      level,
      name: this.name,
      msg: messageText,
      meta: meta || this.baseMeta,
      line,
      consoleLine,
      consoleMethod,
      isRaw,
      isOriginal,
    };
  }

  log(level, msg, meta) {
    const upperLevel = String(level || 'INFO').toUpperCase();
    const record = this.createRecord(upperLevel, msg, meta);
    this.dispatch(record);
  }

  info(msg, meta) {
    const record = this.createRecord('INFO', msg, meta);
    this.dispatch(record);
  }

  warn(msg, meta) {
    const record = this.createRecord('WARN', msg, meta);
    this.dispatch(record);
  }

  error(msg, meta) {
    const record = this.createRecord('ERROR', msg, meta);
    this.dispatch(record);
  }

  Original(msg, meta) {
    const record = this.createRecord('ORIGINAL', msg, meta, { isOriginal: true });
    this.dispatch(record);
  }

  logRaw(level, msg, meta) {
    const upperLevel = String(level || 'RAW').toUpperCase();
    const record = this.createRecord(upperLevel, msg, meta, { isRaw: true });
    this.dispatch(record);
  }

  child(name, meta) {
    return new Logger({
      name: name || this.name,
      handlers: this.handlers,
      filterSensitiveInfo: this.filterSensitiveInfo,
      lineFormatter: this.lineFormatter,
      rawFormatter: this.rawFormatter,
      baseMeta: meta || this.baseMeta,
    });
  }

  safeStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }
}

module.exports = Logger;
