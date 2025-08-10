# tool-description.json 標準格式

此檔案描述單一工具的基本資訊與範例，方便 ToolReferencePlugin 收集並提供給 LLM，並促進工具的使用。

下面的json檔案就是LLM如何呼叫使用工具的格式

```json
{
  "toolName": "exampleTool",
  "description": "工具用途簡述",
  "input" : "範例輸入"
}
```
- `toolName`：工具名稱，需與插件一致。
- `description`：功能說明。
- `input`：輸入範例。
