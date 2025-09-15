module.exports = {
  // 解析 JSON 字串並回傳整理後的物件
  parse: require('./impl/parse'),
  // 提供獨立的清理函式供其他模組使用
  cleanObject: require('./utils/cleanObject')
};
