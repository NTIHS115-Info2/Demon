const fs = require('fs');
const path = require('path');

class StreamPool {
  constructor() {
    this.streamMap = new Map();
  }

  getStream(logFileName, logDir) {
    let fileName = logFileName || 'default.log';
    if (!fileName.includes('.log')) {
      fileName += '.log';
    }

    if (this.streamMap.has(fileName)) {
      return { stream: this.streamMap.get(fileName), fileName };
    }

    const filePath = path.resolve(logDir, fileName);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.streamMap.set(fileName, stream);

    return { stream, fileName };
  }
}

module.exports = StreamPool;
