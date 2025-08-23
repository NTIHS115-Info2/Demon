# tool-description.json 標準格式

此檔案描述單一工具的基本資訊與範例，方便 ToolReferencePlugin 收集並提供給 LLM，並促進工具的使用。

以下為標準結構範例，示範如何描述工具的輸入與輸出，供上層 LLM 與下層插件開發者參考。

```json
{
  "toolName": "exampleTool",
  "description": "工具用途簡述",
  "input": {
    "param": "參數說明與格式規範"
  },
  "output": {
    "success": true,
    "result": "範例結果",
    "resultType": "範例類型"
  }
}
```

- `toolName`：工具名稱，需與插件一致。
- `description`：功能說明。
- `input`：輸入範例和格式規範，可用物件詳列各欄位。
- `output`：輸出範例與欄位說明，需統一支援下列欄位：
  - `success`：布林值。成功為 `true`，失敗為 `false`。
  - `result`：任意型別。成功時的結果值。
  - `resultType`：字串。成功時的結果類型。
  - `error`：字串，可選。僅在失敗時回傳錯誤訊息。
  - `value`：任意型別，可選。若錯誤時需要附帶資料，使用此欄位。

### 成功回傳範例

```json
{
  "success": true,
  "result": "計算結果",
  "resultType": "time"
}
```

### 失敗回傳範例

```json
{
  "success": false,
  "error": "錯誤原因",
  "value": {"detail": "可選的附加資訊"}
}
```

> 注意：實際呼叫工具時，傳給工具的 JSON 物件僅允許包含 `toolName` 與 `input` 兩個欄位，以避免被視為一般資料。工具回傳時則必須遵循上述 `output` 規範。
