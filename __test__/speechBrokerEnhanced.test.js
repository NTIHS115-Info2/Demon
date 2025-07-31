const { EventEmitter } = require('events');

// 模擬 TalkToDemon
jest.mock('../src/core/TalkToDemon.js', () => {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    closeGate: jest.fn(),
    openGate: jest.fn(),
    manualAbort: jest.fn(),
    talk: jest.fn(),
    getState: jest.fn(() => 'busy'),
    getGateState: jest.fn(() => 'open')
  });
}, { virtual: true });

// 模擬 PluginsManager
jest.mock('../src/core/pluginsManager.js', () => ({
  send: jest.fn(),
  getPluginState: jest.fn(async () => 1)
}), { virtual: true });

const talker = require('../src/core/TalkToDemon.js');
const PM = require('../src/core/pluginsManager.js');
const speechBrokerLocal = require('../src/plugins/speechBroker/strategies/local/index.js');

// 輔助函數：等待異步操作完成
const waitForAsync = () => new Promise(resolve => setTimeout(resolve, 50));

describe('SpeechBroker Enhanced Requirements', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await speechBrokerLocal.offline();
  });

  describe('句尾標點偵測與累積機制', () => {
    test('應當累積文字直到遇到句尾標點', async () => {
      await speechBrokerLocal.online();
      
      // 模擬逐字輸出
      talker.emit('data', '你');
      talker.emit('data', '好');
      talker.emit('data', '世');
      talker.emit('data', '界');
      
      await waitForAsync();
      
      // 此時還不應該發送到TTS
      expect(PM.send).not.toHaveBeenCalled();
      
      // 遇到句尾標點才發送
      talker.emit('data', '！');
      
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '你好世界!');
    });

    test('支援多種句尾標點符號', async () => {
      await speechBrokerLocal.online();
      
      const testCases = [
        { input: ['測試', '。'], expected: '測試。' },
        { input: ['問題', '？'], expected: '問題?' },
        { input: ['驚嘆', '！'], expected: '驚嘆!' },
        { input: ['波浪', '～'], expected: '波浪~' },
      ];

      for (const testCase of testCases) {
        PM.send.mockClear();
        for (const chunk of testCase.input) {
          talker.emit('data', chunk);
        }
        await waitForAsync();
        expect(PM.send).toHaveBeenCalledWith('tts', testCase.expected);
      }
    });
  });

  describe('sanitizeChunk() 清理表情／全形符號', () => {
    test('應移除表情符號', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '你好');
      talker.emit('data', '(微笑)');
      talker.emit('data', '世界');
      talker.emit('data', '(害羞)');
      talker.emit('data', '！');
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '你好世界!');
    });

    test('應處理全形標點符號', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '全形測試');
      talker.emit('data', '？'); // 全形問號
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '全形測試?');
    });

    test('應移除emoji', async () => {
      await speechBrokerLocal.online();
      
      const testCases = [
        { input: '愛心♥', expected: '愛心' },
        { input: '紅心❤結束', expected: '紅心結束' },
        { input: '閃亮💖測試', expected: '閃亮測試' },
        { input: '微笑😊世界', expected: '微笑世界' },
        { input: '愛心眼😍表情', expected: '愛心眼表情' },
      ];

      for (const testCase of testCases) {
        PM.send.mockClear();
        talker.emit('data', testCase.input);
        talker.emit('data', '。');
        await waitForAsync();
        
        expect(PM.send).toHaveBeenCalledWith('tts', testCase.expected + '。');
      }
    });

    test('應處理複雜表情組合', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '複雜');
      talker.emit('data', '(開心)');
      talker.emit('data', '測試');
      talker.emit('data', '(笑)');
      talker.emit('data', '內容');
      talker.emit('data', '♥');
      talker.emit('data', '(驚訝)');
      talker.emit('data', '結束');
      talker.emit('data', '！');
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '複雜測試內容結束!');
    });

    test('應保留正常括號內容', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '數學');
      talker.emit('data', '(1+2=3)');
      talker.emit('data', '公式');
      talker.emit('data', '。');
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '數學(1+2=3)公式。');
    });
  });

  describe('end/abort 時自動補播殘句', () => {
    test('end事件時應補播未完成的句子', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '未完成的句子');
      expect(PM.send).not.toHaveBeenCalled();
      
      talker.emit('end');
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '未完成的句子.');
    });

    test('abort事件時應補播未完成的句子', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('data', '中斷的句子');
      expect(PM.send).not.toHaveBeenCalled();
      
      talker.emit('abort');
      await waitForAsync();
      
      expect(PM.send).toHaveBeenCalledWith('tts', '中斷的句子.');
    });

    test('空字串時不應補播', async () => {
      await speechBrokerLocal.online();
      
      talker.emit('end');
      await waitForAsync();
      
      expect(PM.send).not.toHaveBeenCalled();
    });
  });

  describe('TTS 缺席時警告但不中斷', () => {
    test('TTS離線時應警告但不中斷處理', async () => {
      PM.getPluginState.mockResolvedValue(0); // TTS離線
      
      await speechBrokerLocal.online();
      
      talker.emit('data', '測試句子');
      talker.emit('data', '。');
      await waitForAsync();
      
      // 不應該調用send，但也不應該拋出錯誤
      expect(PM.send).not.toHaveBeenCalled();
      expect(PM.getPluginState).toHaveBeenCalledWith('tts');
    });
  });

  describe('offline 移除事件監聽', () => {
    test('offline後不應繼續處理事件', async () => {
      await speechBrokerLocal.online();
      await speechBrokerLocal.offline();
      
      talker.emit('data', '離線後的數據');
      talker.emit('data', '。');
      await waitForAsync();
      
      expect(PM.send).not.toHaveBeenCalled();
    });

    test('重複offline不應出錯', async () => {
      await speechBrokerLocal.online();
      await speechBrokerLocal.offline();
      
      expect(async () => {
        await speechBrokerLocal.offline();
      }).not.toThrow();
    });
  });

  describe('狀態管理', () => {
    test('應正確回報線上/離線狀態', async () => {
      expect(await speechBrokerLocal.state()).toBe(0);
      
      await speechBrokerLocal.online();
      expect(await speechBrokerLocal.state()).toBe(1);
      
      await speechBrokerLocal.offline();
      expect(await speechBrokerLocal.state()).toBe(0);
    });
  });
});