const LogSession = require('../session/LogSession');
const StreamPool = require('../sinks/StreamPool');
const config = require('../config');

let sessionInstance = null;
let streamPoolInstance = null;

function getSession() {
  if (!sessionInstance) {
    sessionInstance = new LogSession({ baseLogPath: config.getBaseLogPath() });
  }
  return sessionInstance;
}

function getStreamPool() {
  if (!streamPoolInstance) {
    streamPoolInstance = new StreamPool();
  }
  return streamPoolInstance;
}

module.exports = {
  getSession,
  getStreamPool,
};
