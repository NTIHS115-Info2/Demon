const path = require('path');
const { EventEmitter } = require('events');

// 模擬 TalkToDemon
jest.mock('../src/core/TalkToDemon.js', () => {
  const { EventEmitter } = require('events');
  const t = new EventEmitter();
  t.closeGate = jest.fn();
  t.openGate = jest.fn();
  t.manualAbort = jest.fn();
  t.talk = jest.fn();
  t.getState = jest.fn(() => 'busy');
  t.getGateState = jest.fn(() => 'open');
  return t;
}, { virtual: true });
const talkerPath = require.resolve('../src/core/TalkToDemon.js');
const talkerMock = require(talkerPath);
const gateState = talkerMock.getGateState;

// 模擬 PluginsManager (僅用於 sendToTTS 時查詢狀態，但 ASR 目前未使用)
jest.mock('../src/core/pluginsManager.js', () => ({
  getPluginState: jest.fn(async () => 1),
  send: jest.fn(),
}), { virtual: true });
const pmPath = require.resolve('../src/core/pluginsManager.js');
const pmMock = require(pmPath);

// 模擬 python-shell
jest.mock('python-shell', () => {
  const { EventEmitter } = require('events');
  return {
    PythonShell: jest.fn().mockImplementation((script, options) => {
      const emitter = new EventEmitter();
      emitter.script = script;
      emitter.options = options;
      emitter.terminated = false;
      emitter.end = (cb) => { emitter.terminated = true; cb && cb(null, 0, null); };
      return emitter;
    })
  };
}, { virtual: true });

const { PythonShell } = require('python-shell');
const asrLocal = require('../src/plugins/asr/strategies/local');

describe('ASR 本地策略', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await asrLocal.offline();
  });

  test('online 會啟動 PythonShell 並處理事件', async () => {
    await asrLocal.online({ deviceId: '2', sliceDuration: '3' });
    expect(PythonShell).toHaveBeenCalled();

    const inst = PythonShell.mock.results[0].value;
    inst.emit('message', 'asr_start');
    expect(talkerMock.closeGate).toHaveBeenCalled();

    inst.emit('message', 'asr_ignore');
    expect(talkerMock.openGate).toHaveBeenCalled();

    gateState.mockReturnValue('close');
    inst.emit('message', JSON.stringify({ text: '測試句子' }));
    expect(talkerMock.manualAbort).toHaveBeenCalled();
    expect(talkerMock.talk).toHaveBeenCalledWith('爸爸', '測試句子', expect.any(Object));
  });

  test('offline 會結束 PythonShell', async () => {
    await asrLocal.online({});
    const inst = PythonShell.mock.results[0].value;
    const endSpy = jest.spyOn(inst, 'end');
    await asrLocal.offline();
    expect(endSpy).toHaveBeenCalled();
  });
});
