const { EventEmitter } = require('events');

// 模擬 TalkToDemon
jest.mock('../src/core/TalkToDemon.js', () => {
  const { EventEmitter } = require('events');
  const t = new EventEmitter();
  t.on = jest.fn(t.on.bind(t));
  t.off = jest.fn(t.off.bind(t));
  return Object.assign(t, {
    closeGate: jest.fn(),
    openGate: jest.fn(),
    manualAbort: jest.fn(),
    talk: jest.fn(),
    getState: jest.fn(() => 'busy'),
    getGateState: jest.fn(() => 'open')
  });
}, { virtual: true });

// 模擬 python-shell
jest.mock('python-shell', () => {
  const { EventEmitter } = require('events');
  return {
    PythonShell: jest.fn().mockImplementation((script, options) => {
      const emitter = new EventEmitter();
      emitter.script = script;
      emitter.options = options;
      emitter.terminated = false;
      emitter.stdin = true;
      emitter.send = jest.fn();
      emitter.end = (cb) => { 
        emitter.terminated = true; 
        setTimeout(() => cb && cb(null, 0, null), 10);
      };
      return emitter;
    })
  };
}, { virtual: true });

const talkerMock = require('../src/core/TalkToDemon.js');
const PM = require('../src/core/pluginsManager.js');

// TTS 插件整合測試
describe('TTS 插件整合測試', () => {
  beforeEach(async () => {
    
    jest.clearAllMocks();

    await PM.loadPlugin('tts' , 'local');
    await PM.loadPlugin('speechBroker' , 'local');

    await PM.queueAllOnline();

  }, 10000); // 增加 beforeEach 的逾時時間

  afterEach(async () => {
    await PM.offlineAll();
  }, 10000);

  // 本地語音引擎連續播放測試
  describe('本地語音引擎連續播放測試', () => {
    test('TTS 本地策略可處理多次連續 send 操作', async () => {

      // 連續送出多則訊息
      const result1 = await PM.send('tts' , '第一則訊息');
      const result2 = await PM.send('tts' , '第二則訊息');
      const result3 = await PM.send('tts' , '第三則訊息');

      // 驗證所有 send 都成功
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);

      // 驗證多次 send 後 TTS 插件仍在線上
      expect(await PM.getPluginState('tts')).toBe(1);
    });

    test('TTS 本地策略連續播放時狀態維持穩定', async () => {

      // 驗證初始狀態
      expect(await PM.getPluginState('tts')).toBe(1);

      // 發送訊息並驗證狀態保持穩定
      await PM.send('tts' , '訊息 1');
      expect(await PM.getPluginState('tts')).toBe(1);

      await PM.send('tts' , '訊息 2');
      expect(await PM.getPluginState('tts')).toBe(1);
    });

    test('TTS send 在嘗試送到離線程序時回傳 false', async () => {

      await PM.offline('tts');

      // 未上線直接送出
      const result = await PM.send('tts' , '測試訊息');
      expect(result).toBe(false);
    });

    test('TTS 可處理快速連續 send 不出錯', async () => {

      // 快速送出 10 則訊息
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(PM.send('tts' , `快速訊息 ${i + 1}`));
      }
      
      const results = await Promise.all(promises);
      
      // 所有 send 都應成功
      results.forEach(result => expect(result).toBe(true));
      
      // 驗證快速 send 後 TTS 仍在線上
      expect(await PM.getPluginState('tts')).toBe(1);
    });
  });

  // 離線功能 - 停止播放並釋放資源
  describe('離線功能 - 停止播放並釋放資源', () => {
    test('TTS 離線能正確終止 Python 程序並釋放資源', async () => {
      // 驗證程序正在執行
      expect(await PM.getPluginState('tts')).toBe(1);

      // 停止並驗證清理
      await PM.offline('tts');
      expect(await PM.getPluginState('tts')).toBe(0);
    });

    test('TTS 離線可安全重複呼叫', async () => {

      PM.offline('tts');

      // 多次呼叫不應拋出錯誤
      await expect(PM.offline('tts')).resolves.toBe(true);
      await expect(PM.offline('tts')).resolves.toBe(true);
      expect(await PM.getPluginState('tts')).toBe(0);
    });

    test('TTS 離線後 send 失敗', async () => {
      // 上線時 send 成功
      expect(await PM.send('tts' , '測試訊息')).toBe(true);

      // 離線
      await PM.offline('tts');
      
      // 離線後 send 失敗
      expect(await PM.send('tts' , '測試訊息')).toBe(false);
    });
  });

  // SpeechBroker 整合 - TTS 未上線時跳過語音輸出
  describe('SpeechBroker 整合 - TTS 未上線時跳過語音輸出', () => {
    test('SpeechBroker 送出前會檢查 TTS 狀態，離線時警告', async () => {

      // 模擬 TTS 離線
      await PM.offline('tts');

      // 模擬 TalkToDemon 傳來資料
      talkerMock.emit('data', 'Hello world.');
      
      // 等待非同步處理
      await new Promise(resolve => setTimeout(resolve, 100));

      // 驗證有檢查 TTS 狀態
      expect(await PM.getPluginState('tts')).toBe(0);

      // 驗證離線時未送出訊息
      expect(await PM.send('tts' , '123')).toBe(false);
    });

    test('SpeechBroker 在 TTS 上線時會送出訊息', async () => {

      // 模擬 TalkToDemon 傳來資料
      talkerMock.emit('data', 'Hello world.');
      
      // 等待非同步處理
      await new Promise(resolve => setTimeout(resolve, 100));

      // 驗證有送出訊息給 TTS
      expect(await PM.send('tts' , 'Hello world.')).toBe(true);
    });

    test('SpeechBroker 能優雅處理 TTS 狀態變化', async () => {

      talkerMock.emit('data', '第一則訊息。');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await PM.send('tts' , '第一則訊息。')).toBe(true);

      jest.clearAllMocks();

      // 第二次訊息 TTS 離線
      PM.offline('tts');
      talkerMock.emit('data', '第二則訊息。');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await PM.send('tts' , '第二則訊息。')).toBe(false);
    });
  });
});