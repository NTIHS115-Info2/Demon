const path = require('path');
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
const talkerPath = require.resolve('../src/core/TalkToDemon.js');
const talkerMock = require(talkerPath);

// 模擬 PluginsManager
jest.mock('../src/core/pluginsManager.js', () => ({
  send: jest.fn(),
  getPluginState: jest.fn(async () => 1)
}), { virtual: true });
const pmPath = require.resolve('../src/core/pluginsManager.js');
const pmMock = require(pmPath);

const brokerLocal = require('../../src/plugins/speechBroker/strategies/local');

describe('SpeechBroker 本地策略', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await brokerLocal.offline();
  });

  test('online 監聽 data 並轉送至 TTS', async () => {
    await brokerLocal.online();
    expect(talkerMock.on).toHaveBeenCalledWith('data', expect.any(Function));
    const handler = talkerMock.on.mock.calls.find(c => c[0] === 'data')[1];
    talkerMock.emit('data', '你好');
    talkerMock.emit('data', '。');
    await new Promise(process.nextTick);
    expect(pmMock.send).toHaveBeenCalledWith('tts', '你好。');
  });

  test('offline 會移除監聽', async () => {
    await brokerLocal.online();
    await brokerLocal.offline();
    expect(talkerMock.off).toHaveBeenCalled();
  });
});
