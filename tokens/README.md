# tokens 設定說明

此目錄用於儲存不應進入版本控制的敏感設定檔。請建立 `tokens/icloud.js` 並以 CommonJS 模式輸出下列欄位：

```js
module.exports = {
  ICLOUD_USER: 'apple-id@example.com',
  ICLOUD_APP_PASSWORD: 'xxxx-xxxx-xxxx-xxxx',
  ICLOUD_CAL_NAME: '小惡魔行事曆',
  TIMEZONE: 'Asia/Taipei',
  SYNC_INTERVAL_MINUTES: 1,
};
```

> 注意：此檔案僅供參考，實際憑證請透過安全管道配置，勿提交至版本庫。
