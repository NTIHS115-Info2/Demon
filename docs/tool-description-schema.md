# tool-description.json 標準格式

此檔案描述單一工具的基本資訊與範例，方便 ToolReferencePlugin 收集並提供給 LLM。

```json
{
  "name": "exampleTool",
  "description": "工具用途簡述",
  "usage": {
    "input": {"param": "範例輸入"},
    "output": "範例輸出"
  }
}
```
- `name`：工具名稱，需與插件一致。
- `description`：功能說明。
- `usage.input`：輸入範例，可包含必要欄位。
- `usage.output`：對應輸出範例。
