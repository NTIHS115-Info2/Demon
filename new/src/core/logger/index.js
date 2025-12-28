const LoggerCore = require('./core/Logger');
const registry = require('./core/registry');
const config = require('./config');
const { filterSensitiveInfo, hasSensitiveInfo } = require('./filters/sensitiveFilter');
const LineFormatter = require('./formatters/LineFormatter');
const RawFormatter = require('./formatters/RawFormatter');
const FileHandler = require('./handlers/FileHandler');
const ConsoleHandler = require('./handlers/ConsoleHandler');

class Logger extends LoggerCore {
  constructor(logFileName, options = {}) {
    const session = registry.getSession();
    const streamPool = registry.getStreamPool();
    const fileHandler = new FileHandler({ logFileName, session, streamPool });
    const consoleHandler = new ConsoleHandler({ config });

    super({
      name: options.name || logFileName || 'default',
      handlers: [fileHandler, consoleHandler],
      filterSensitiveInfo,
      lineFormatter: LineFormatter,
      rawFormatter: RawFormatter,
      baseMeta: options.meta || null,
    });
  }

  static hasSensitiveInfo(message) {
    return hasSensitiveInfo(message);
  }
}

module.exports = Logger;
module.exports.SetConsoleLog = (value) => {
  config.setConsoleLog(!!value);
};
module.exports.SetBaseLogPath = (path) => {
  config.setBaseLogPath(path);
}
module.exports.filterSensitiveInfo = filterSensitiveInfo;

