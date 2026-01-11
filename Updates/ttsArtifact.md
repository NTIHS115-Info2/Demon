#### ttsArtifact 插件更新紀錄

### [v0.1]
## New
- 新增 ttsArtifact 插件，負責呼叫 ttsEngine 並建立可即時讀取的音訊 artifact
- 建立可增量寫入的 WAV 檔案管線，支援 creating 狀態下的 streaming 讀取
- 加入 artifact metadata 落地保存與 URL 回傳，並強調 ttsEngine/ttsArtifact 的責任邊界
