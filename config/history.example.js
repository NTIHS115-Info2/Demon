// 歷史管理器設定檔範例
// 請複製此檔案為 history.js 並根據需要調整參數

module.exports = {
  // 每個使用者保留的最大訊息數量
  maxMessages: 100,
  
  // 歷史訊息過期天數
  expireDays: 7,
  
  // 備份檔案數量（0 表示不備份）
  backupCount: 3,
  
  // 單個歷史檔案的最大大小（位元組）
  // 超過此大小會自動進行輪轉備份
  maxFileSize: 1048576 // 1MB
};