let consoleEnabled = false;
let baseLogPath = null;

function setConsoleLog(enabled) {
  consoleEnabled = !!enabled;
}

function getConsoleLog() {
  return consoleEnabled;
}

function setBaseLogPath(pathValue) {
  baseLogPath = pathValue;
}

function getBaseLogPath() {
  return baseLogPath;
}

module.exports = {
  setConsoleLog,
  getConsoleLog,
  setBaseLogPath,
  getBaseLogPath,
};
