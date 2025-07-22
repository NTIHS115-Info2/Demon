### 給codex的訊息

### 版本更新要點
## MessageHandler
- 將MsgHandler 改為針對私訊,提及訊息,回覆訊息 將接收數據傳入給TalkToDemon 接收後反傳的 用標點符號為判斷 一句一句將回覆推送回去
- 這個版本先針對我自己 所以說要特別判斷id 是不是 cookice 如果不是的話 就不理會（統一用 “我還學不會跟別人說話” 來回覆）

- 私訊 ➜ handleDirectMessage
- 提及 ➜ handleMentionMessage
- 回覆 ➜ handleReplyMessage

- 所有版本的對話 都只會將使用者輸入送進給talktodemon 他會自己管控