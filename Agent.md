### 分支代辦事項

## 主要目的

* 撰寫tools - OsInfor
* 更新所有插件的updateStrategy邏輯
* 為所有插件新增Strategy權重 統一寫在插件root/index內，但同時支援外部輸入權重

## OsInfor
- 要照著tools更新規範更新
- 負責將所有Os的資訊調用出來，例如平台,架構,主機名稱等
- 接口1. table調用，會一次傳出所有資訊，供調用者取用
- 接口2. 單一取用，傳入對應的資訊名稱，回傳該資訊

## updateStrategy邏輯更新（預設時）
- 邏輯排序方式為最優先到最低
# remote判斷
- 判斷remote能不能用的方式是ping server下轄的infor(ngrok) 看server有無回應
# local判斷
- local判斷為remote不能使用,server不能使用時的最後選擇
# server判斷
- 判斷server能不能用的方式是調取OSInfor, 如果資訊正確，那就是使用server
- 判斷server的資訊一起寫在infor.js內