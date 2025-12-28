class FileHandler {
  constructor(options = {}) {
    const { logFileName = 'default.log', session, streamPool } = options;
    this.session = session;
    this.streamPool = streamPool;
    this.logFileName = logFileName;
    this.stream = null;
  }

  ensureStream() {
    if (this.stream) return;
    const logDir = this.session.getLogPath();
    const { stream } = this.streamPool.getStream(this.logFileName, logDir);
    this.stream = stream;
  }

  emit(record) {
    this.ensureStream();
    const line = record.line || '';
    this.stream.write(line + '\n');
  }
}

module.exports = FileHandler;
