# Email Concierge (Perception Layer)

## 使用方式

1. 安裝依賴：`googleapis` 與 `google-auth-library`。
2. 於 `Server/calendar/config/credentials.json` 與 `Server/calendar/config/token.json` 放置 OAuth2 憑證與 token。
3. 初始化插件：

```js
const emailConcierge = require('./src/plugins/emailConcierge');

await emailConcierge.start({
  scanInterval: 60000,
  maxEmails: 10
});
```

4. 取得未讀郵件列表：

```js
const unread = await emailConcierge.client.checkUnreadMessages(10);
```

5. 取得單封郵件內容：

```js
const detail = await emailConcierge.client.getMessageDetails(unread[0].id);
```

> 注意：此模組遵循資安限制，僅允許記錄 Message ID 與 Status。
