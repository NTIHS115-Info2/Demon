# send 使用說明

此文件說明如何透過 `send` 方法調用 Discord 插件功能。

## 基本格式
```json
{
  "func": "send",
  "channelId": "頻道 ID",
  "message": "要傳送的訊息"
}
```
`func` 為指定要執行的內部功能。若為 `send`，會由策略負責發送訊息。

## 其他功能
`func` 亦可指定為 `restart` 等插件公開方法，參數以物件傳遞，結構如下：
```json
{
  "func": "restart",
  "token": "機器人 Token"
}
```

所有參數依功能不同而有差異，請參考對應程式碼。
