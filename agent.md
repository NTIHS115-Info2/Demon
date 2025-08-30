# 目的 : 移除LLM產生Json時會輸出的Markdown標記(```)

# 實作方式
先判別Markdown，如果符合開頭以及後面追加的是Json，那就等待工具判別，如果確認是工具，那就把將工具輸出包住的Markdown與Json移除，其餘照舊