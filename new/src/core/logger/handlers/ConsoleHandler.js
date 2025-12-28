class ConsoleHandler {
  constructor(options = {}) {
    const { config } = options;
    this.config = config;
  }

  emit(record) {
    if (!this.config || !this.config.getConsoleLog()) {
      return;
    }

    const method = record.consoleMethod || 'log';
    const line = record.consoleLine || record.line;
    if (typeof console[method] === 'function') {
      console[method](line);
    } else {
      console.log(line);
    }
  }
}

module.exports = ConsoleHandler;
