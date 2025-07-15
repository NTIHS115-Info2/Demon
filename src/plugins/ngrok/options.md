# ngrok 插件 options 使用說明

## online() / restart()
- **binPath**: `string`，ngrok 執行檔路徑，預設為 `Server/ngrok/ngrok.exe`
- **port**: `number`，ngrok 與 Express 所監聽的本地埠號，預設 `3000`
- **command**: `string`，啟動 ngrok 時使用的模式，例如 `http` 或 `tcp`，預設 `http`
- **extraArgs**: `string[]`，額外傳入的參數陣列

```javascript
await plugins.ngrok.online({
  binPath: 'C:/tools/ngrok.exe',
  port: 8080,
  command: 'http',
  extraArgs: ['--region=ap']
});
```

## send()
透過 `send()` 可註冊或解除子網域對應的腳本，options 結構如下：
- **action**: `string`，必填，`register` 或 `unregister`
- **subdomain**: `string`，子網域名稱
- **handler**: `function(req,res)`，當 action 為 `register` 時需要傳入的處理函式

```javascript
// 註冊
plugins.ngrok.send({
  action: 'register',
  subdomain: 'api',
  handler: (req, res) => {
    res.json({ ok: true });
  }
});

// 解註冊
plugins.ngrok.send({
  action: 'unregister',
  subdomain: 'api'
});
```

## offline()
`offline()` 不需要任何 options，呼叫後會關閉 ngrok 及對應的 Express。

## state()
回傳數字狀態：
- `0` - 已關閉
- `1` - 運行中
- `-1` - 查詢錯誤
```

