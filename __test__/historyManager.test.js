const fs = require('fs');
const path = require('path');

const historyManager = require('../src/core/historyManager');

const userId = 'jestUser';
const filePath = path.resolve(__dirname, '..', 'history', `${userId}.json`);

describe('historyManager', () => {
  beforeEach(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await historyManager.clearHistory(userId);
  });

  test('appendMessage 與 getHistory', async () => {
    await historyManager.appendMessage(userId, 'user', 'hi');
    await historyManager.appendMessage(userId, 'assistant', 'hello');
    const hist = await historyManager.getHistory(userId, 2);
    expect(hist.length).toBe(2);
    expect(hist[0].role).toBe('user');
    expect(hist[1].role).toBe('assistant');
  });

  test('getHistory limit', async () => {
    for (let i = 0; i < 5; i++) {
      await historyManager.appendMessage(userId, 'user', 'm' + i);
    }
    const hist = await historyManager.getHistory(userId, 3);
    expect(hist.length).toBe(3);
    expect(hist[0].content).toBe('m2');
  });

  test('clearHistory 完全移除檔案', async () => {
    // 先新增一些歷史
    await historyManager.appendMessage(userId, 'user', 'test message');
    expect(fs.existsSync(filePath)).toBe(true);
    
    // 清除歷史
    await historyManager.clearHistory(userId);
    
    // 檢查檔案是否被刪除
    expect(fs.existsSync(filePath)).toBe(false);
    
    // 檢查歷史是否為空
    const hist = await historyManager.getHistory(userId);
    expect(hist.length).toBe(0);
  });

  test('clearHistory 處理不存在的檔案', async () => {
    // 確保檔案不存在
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    // 應該不會拋出錯誤
    await expect(historyManager.clearHistory(userId)).resolves.not.toThrow();
    
    // 歷史應該為空
    const hist = await historyManager.getHistory(userId);
    expect(hist.length).toBe(0);
  });

  test('appendMessage 包含完整角色資訊', async () => {
    await historyManager.appendMessage(userId, 'system', '系統訊息');
    await historyManager.appendMessage(userId, 'user', '使用者訊息');
    await historyManager.appendMessage(userId, 'assistant', '助手回覆');
    
    const hist = await historyManager.getHistory(userId);
    expect(hist.length).toBe(3);
    expect(hist[0]).toHaveProperty('role', 'system');
    expect(hist[0]).toHaveProperty('content', '系統訊息');
    expect(hist[0]).toHaveProperty('timestamp');
    expect(typeof hist[0].timestamp).toBe('number');
    
    expect(hist[1].role).toBe('user');
    expect(hist[2].role).toBe('assistant');
  });

  test('getHistory 返回最近 N 筆紀錄', async () => {
    // 新增 10 筆紀錄
    for (let i = 0; i < 10; i++) {
      await historyManager.appendMessage(userId, 'user', `message ${i}`);
    }
    
    // 測試不同的 N 值
    const hist3 = await historyManager.getHistory(userId, 3);
    expect(hist3.length).toBe(3);
    expect(hist3[0].content).toBe('message 7'); // 最近 3 筆中最舊的
    expect(hist3[2].content).toBe('message 9'); // 最新的
    
    const hist1 = await historyManager.getHistory(userId, 1);
    expect(hist1.length).toBe(1);
    expect(hist1[0].content).toBe('message 9'); // 最新的一筆
  });

  test('裁剪機制 - 筆數限制', async () => {
    // 暫時修改 maxMessages 限制為測試用
    const originalMax = historyManager.maxMessages;
    historyManager.maxMessages = 3;
    
    try {
      // 新增 5 筆紀錄
      for (let i = 0; i < 5; i++) {
        await historyManager.appendMessage(userId, 'user', `msg${i}`);
      }
      
      // 應該只保留最後 3 筆
      const hist = await historyManager.getHistory(userId);
      expect(hist.length).toBe(3);
      expect(hist[0].content).toBe('msg2');
      expect(hist[2].content).toBe('msg4');
    } finally {
      // 還原設定
      historyManager.maxMessages = originalMax;
    }
  });

  test('錯誤處理 - 讀取失敗不中斷服務', async () => {
    const testUserId = 'errorTestUser';
    
    // 測試讀取不存在的檔案
    const hist = await historyManager.getHistory(testUserId);
    expect(hist).toEqual([]);
    
    // 測試清除不存在的檔案
    await expect(historyManager.clearHistory(testUserId)).resolves.not.toThrow();
  });

  test('clearHistory 參數驗證', async () => {
    // 測試 userId 為空的情況
    await expect(historyManager.clearHistory('')).rejects.toThrow('userId 不可為空');
    await expect(historyManager.clearHistory(null)).rejects.toThrow('userId 不可為空');
    await expect(historyManager.clearHistory(undefined)).rejects.toThrow('userId 不可為空');
  });
});
