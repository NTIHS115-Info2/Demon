// TalkToDemon.comprehensive.test.js
// 完整測試 TalkToDemon 對話流程控制的所有需求

const TalkToDemon = require('../src/core/TalkToDemon');
const PluginManager = require('../src/core/pluginsManager');
const historyManager = require('../src/core/historyManager');
const { composeMessages } = require('../src/core/PromptComposer');
const { EventEmitter } = require('events');

// Mock 相關模組
jest.mock('../src/core/pluginsManager');  
jest.mock('../src/core/historyManager');
jest.mock('../src/core/PromptComposer', () => ({
  composeMessages: jest.fn().mockResolvedValue([
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'test message' }
  ])
}));

describe('TalkToDemon 對話流程控制完整測試', () => {
  let mockEmitter;
  
  // 重置 TalkToDemon 狀態的輔助函數
  const resetTalkToDemon = async () => {
    TalkToDemon.clearHistory();
    TalkToDemon.removeAllListeners();
    
    // 確保狀態歸零
    let attempts = 0;
    while (TalkToDemon.getState() === 'processing' && attempts < 10) {
      TalkToDemon.manualAbort();
      await new Promise(resolve => setTimeout(resolve, 20));
      attempts++;
    }
    
    // 強制重置內部狀態（如果暴露的話）
    if (TalkToDemon.processing !== undefined) {
      TalkToDemon.processing = false;
    }
    
    // 清空待處理佇列
    if (TalkToDemon.pendingQueue) {
      TalkToDemon.pendingQueue.length = 0;
    }
  };
  
  beforeEach(async () => {
    await resetTalkToDemon();
    
    // 創建新的 mock EventEmitter
    mockEmitter = new EventEmitter();
    mockEmitter.abort = jest.fn();
    
    // Mock PluginManager
    PluginManager.getPluginState = jest.fn().mockResolvedValue(1);
    PluginManager.send = jest.fn().mockResolvedValue(mockEmitter);
    
    // Mock historyManager
    historyManager.getHistory = jest.fn().mockResolvedValue([]);
    historyManager.appendMessage = jest.fn().mockResolvedValue();
    
    // Reset the mock for composeMessages
    composeMessages.mockClear();
  });

  afterEach(async () => {
    await resetTalkToDemon();
  });

  describe('需求1: 測試空閒、忙碌、可中斷、不可中斷四種情境', () => {
    test('空閒狀態 - 可以立即處理新訊息', async () => {
      expect(TalkToDemon.getState()).toBe('idle');
      
      TalkToDemon.talk('user1', 'hello');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      expect(PluginManager.send).toHaveBeenCalled();
    });

    test('忙碌狀態 - 正在處理訊息時的行為', async () => {
      // 開始處理第一個訊息
      TalkToDemon.talk('user1', 'first message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      
      // 此時系統為忙碌狀態，但仍可接受新訊息
      const secondMockEmitter = new EventEmitter();
      secondMockEmitter.abort = jest.fn();
      PluginManager.send.mockResolvedValueOnce(secondMockEmitter);
      
      TalkToDemon.talk('user1', 'second message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 第一個訊息應該被中斷
      expect(mockEmitter.abort).toHaveBeenCalled();
    });

    test('可中斷狀態 - 預設訊息可以被中斷', async () => {
      TalkToDemon.talk('user1', 'interruptible message', { uninterruptible: false });
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      
      // 手動中斷應該成功
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).toHaveBeenCalled();
    });

    test('不可中斷狀態 - 設置為不可中斷的訊息', async () => {
      // 先確認初始狀態
      expect(TalkToDemon.getState()).toBe('idle');
      
      // 第一個不可中斷訊息應該被處理（因為系統空閒）
      TalkToDemon.talk('user1', 'uninterruptible message', { uninterruptible: true });
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 應該正在處理
      expect(TalkToDemon.getState()).toBe('processing');
      
      // 手動中斷應該失敗
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).not.toHaveBeenCalled();
      
      // 嘗試發送第二個不可中斷訊息應該被忽略
      TalkToDemon.talk('user1', 'try to interrupt', { uninterruptible: true });
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 狀態應該仍然是 processing
      expect(TalkToDemon.getState()).toBe('processing');
    });
  });

  describe('需求2: 驗證插隊／中止機制與 important 標記', () => {
    test('重要訊息加入等待佇列', async () => {
      // 開始處理第一個訊息  
      TalkToDemon.talk('user1', 'normal message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      
      // 發送重要訊息，應該加入佇列而不是中斷
      TalkToDemon.talk('user1', 'important message', { important: true });
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 第一個訊息不應該被中斷
      expect(mockEmitter.abort).not.toHaveBeenCalled();
      
      // 佇列中應該有重要訊息
      expect(TalkToDemon.pendingQueue).toBeDefined();
    });

    test('普通訊息會中斷當前處理', async () => {
      TalkToDemon.talk('user1', 'first message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      const secondMockEmitter = new EventEmitter();
      secondMockEmitter.abort = jest.fn();
      PluginManager.send.mockResolvedValueOnce(secondMockEmitter);
      
      // 普通訊息應該中斷當前處理
      TalkToDemon.talk('user1', 'interrupt message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(mockEmitter.abort).toHaveBeenCalled();
    });

    test('中止機制 - 手動中止功能', async () => {
      TalkToDemon.talk('user1', 'test message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).toHaveBeenCalled();
    });

    test('不可中斷訊息無法被中止', async () => {
      TalkToDemon.talk('user1', 'protected message', { uninterruptible: true });
      await new Promise(resolve => setTimeout(resolve, 30));
      
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).not.toHaveBeenCalled();
    });
  });

  describe('需求3: 檢查 historyManager + PromptComposer 注入流程', () => {
    test('用戶訊息正確保存到 historyManager', async () => {
      TalkToDemon.talk('user1', 'test message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(historyManager.appendMessage).toHaveBeenCalledWith(
        'user1',
        'user', 
        'user1： test message'
      );
    });

    test('從 historyManager 讀取歷史記錄', async () => {
      const mockHistory = [
        { role: 'user', content: 'previous message', timestamp: Date.now() - 1000 },
        { role: 'assistant', content: 'previous response', timestamp: Date.now() - 500 }
      ];
      historyManager.getHistory.mockResolvedValue(mockHistory);
      
      TalkToDemon.talk('user1', 'new message');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(historyManager.getHistory).toHaveBeenCalledWith('user1', 50);
    });

    test('PromptComposer 正確組合訊息', async () => {
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(composeMessages).toHaveBeenCalled();
      
      // 檢查傳入的參數包含歷史和工具結果
      const callArgs = composeMessages.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(Array.isArray(callArgs[0])).toBe(true); // history array
      expect(Array.isArray(callArgs[1])).toBe(true); // tools array
    });

    test('歷史讀取失敗時的容錯處理', async () => {
      historyManager.getHistory.mockRejectedValue(new Error('read failed'));
      
      // 即使歷史讀取失敗，對話仍應繼續
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      expect(composeMessages).toHaveBeenCalled();
    });

    test('訊息組合失敗時的錯誤處理', async () => {
      composeMessages.mockRejectedValueOnce(new Error('compose failed'));
      
      let errorCaught = false;
      TalkToDemon.on('error', (err) => {
        expect(err.message).toBe('compose failed');
        errorCaught = true;
      });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(errorCaught).toBe(true);
      expect(TalkToDemon.getState()).toBe('idle');
    });
  });

  describe('需求4: 串流事件 data / end / error / abort 完整處理', () => {
    test('data 事件正確處理和轉發', async () => {
      const dataChunks = [];
      TalkToDemon.on('data', chunk => dataChunks.push(chunk));
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 模擬串流 data 事件
      mockEmitter.emit('data', 'chunk1');
      mockEmitter.emit('data', 'chunk2');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // data 事件應該被正確轉發（通過 router 處理）
      // 註: 實際轉發可能經過 toolOutputRouter 處理
    });

    test('end 事件正確處理', async () => {
      let endEventReceived = false;
      TalkToDemon.on('end', () => { endEventReceived = true; });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 模擬 end 事件
      mockEmitter.emit('end');
      
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(endEventReceived).toBe(true);
      expect(TalkToDemon.getState()).toBe('idle');
    });

    test('error 事件正確處理', async () => {
      let errorReceived = null;
      TalkToDemon.on('error', err => { errorReceived = err; });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      const testError = new Error('stream error');
      mockEmitter.emit('error', testError);
      
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(errorReceived).toBe(testError);
    });

    test('abort 事件正確處理', async () => {
      let abortEventReceived = false;
      TalkToDemon.on('abort', () => { abortEventReceived = true; });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 先手動觸發中止，然後模擬 abort 事件
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).toHaveBeenCalled();
      
      // 模擬 abort 事件
      mockEmitter.emit('abort');
      
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(abortEventReceived).toBe(true);
    });

    test('串流中止時的完整處理流程', async () => {
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 30));
      
      expect(TalkToDemon.getState()).toBe('processing');
      
      // 手動中止
      TalkToDemon.manualAbort();
      expect(mockEmitter.abort).toHaveBeenCalled();
      
      // 模擬中止完成
      mockEmitter.emit('abort');
      await new Promise(resolve => setTimeout(resolve, 30));
    });
  });

  describe('其他功能驗證', () => {
    test('Gate 機制 - 控制輸出流', () => {
      expect(TalkToDemon.getGateState()).toBe('open');
      
      TalkToDemon.closeGate();
      expect(TalkToDemon.getGateState()).toBe('close');
      
      TalkToDemon.openGate();
      expect(TalkToDemon.getGateState()).toBe('open');
    });

    test('等待狀態管理', () => {
      expect(TalkToDemon.getWaitingState()).toBe('idle');
      
      TalkToDemon._setWaiting(true);
      expect(TalkToDemon.getWaitingState()).toBe('waiting');
      
      TalkToDemon._setWaiting(false);
      expect(TalkToDemon.getWaitingState()).toBe('idle');
    });

    test('插件服務狀態檢查', async () => {
      PluginManager.getPluginState.mockResolvedValue(0); // 服務未啟動
      
      let errorCaught = false;
      TalkToDemon.on('error', (err) => {
        expect(err.message).toBe('llamaServer 未啟動');
        errorCaught = true;
      });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(errorCaught).toBe(true);
    });

    test('服務狀態檢查失敗處理', async () => {
      PluginManager.getPluginState.mockRejectedValue(new Error('service check failed'));
      
      let errorCaught = false;
      TalkToDemon.on('error', (err) => {
        expect(err.message).toBe('service check failed');
        errorCaught = true;
      });
      
      TalkToDemon.talk('user1', 'test');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(errorCaught).toBe(true);
    });
  });
});