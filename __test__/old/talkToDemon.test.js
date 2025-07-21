// __tests__/talkToDemon.test.js
//
// 測試 TalkToDemonManager 在 llama plugin 啟動下的行為
// 引入 TalkToDemonManager 實作 :contentReference[oaicite:1]{index=1}

const talkManager = require('../../src/core/TalkToDemon'); // 如實檔名為 TalkToDemon.js
const PluginManager = require('../../src/core/pluginsManager');
const { EventEmitter } = require('events');

describe('TalkToDemonManager 串流對話測試', () => {
  beforeEach(() => {
    talkManager.clearHistory();
    talkManager.removeAllListeners();
    PluginManager.getPluginState = jest.fn().mockResolvedValue(1);
  });

  test('talk() 會觸發 data 及 end 事件，並正確串接片段', done => {
    const emitter = new EventEmitter();
    PluginManager.send = jest.fn().mockReturnValue(emitter);

    const chunks = [];
    talkManager.on('data', chunk => chunks.push(chunk));
    talkManager.on('end', () => {
      try {
        expect(chunks.join('')).toBe('HelloWorld');
        done();
      } catch (err) {
        done(err);
      }
    });

    talkManager.talk('Tester', 'trigger');

    // 把 emit 包到下一輪，確保 listener 都綁好了
    setImmediate(() => {
      emitter.emit('data', 'Hello');
      emitter.emit('data', 'World');
      emitter.emit('end');
    });
  });
});