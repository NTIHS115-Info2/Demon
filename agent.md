## 📦 Project Overview

* **Name**: `tool-reference-refactor`
* **Purpose**:
  蒐集並整理所有 LLM 插件的工具描述文件；在 LLM 需要使用某個工具時，再精準發送該工具的完整描述文件。

  * 系統輸入 `roughly: true` → 輸出工具名稱 + 簡要描述
  * LLM 輸入 `ToolName: <toolName>` → 輸出該工具的完整描述文件

## 🛠 Tools & Permissions

* **Access scope**: `Full access`（授予 core full access）

## 🔄 Planning / Scheduling

* **Dependencies**: `tools/fileEditor`

## 🎯 Success Criteria

* LLM 請求工具時，能準確回傳單一工具的完整描述
* 當輸入「A 插件名稱」時，能正確反傳該插件的完整描述文件
* 工具描述文件如同原本實作一樣，一有更改即可即時同步

## ⚠️ Limits & Safeguards

* 不允許動到其他插件或腳本
* 若描述文件缺失或讀取失敗，必須回傳錯誤訊息而非空內容
* 必須確保回傳內容完整對應所有請求的插件描述文件

## 🧪 Testing Instructions

* 輸入單一插件名稱，驗證是否回傳正確完整描述
* 輸入多個插件名稱，驗證是否正確回傳所有對應的完整描述
* 修改插件描述文件後，驗證 LLM 請求是否能即時獲取更新

## 🧑‍💻 Dev Tips

* 遵循 plugins 撰寫規範
* 風格與架構可參考已完成的其他插件實作

## 📝 PR Example

* **PR Title**: `[tool-reference-refactor] 重構工具描述文件的收集與回傳機制`
* **PR Description**:

  ```
  - Project purpose:  
    將 toolReference 的職責從「統一收集並一次性發送」改為「即時整理並在 LLM 請求時回傳完整的工具描述文件」。  
    系統輸入 roughly: true → 僅回傳工具名稱與簡要描述；  
    LLM 輸入 ToolName: <toolName> → 回傳完整的工具描述文件。  

  - Tools/Permissions:  
    Full access（授予 core full access）  

  - Success Criteria:  
    - 能準確回傳單一或多個請求插件的完整描述  
    - 輸入插件名稱能正確反傳完整描述  
    - 描述文件可即時同步更新  

  - Limits/Safeguards:  
    - 不允許動到其他插件或腳本  
    - 若描述文件缺失或讀取失敗，必須回傳錯誤訊息而非空內容  
    - 必須確保回傳內容完整對應所有請求的插件描述文件
  ```