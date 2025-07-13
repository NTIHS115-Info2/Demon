const { EventEmitter } = require('events');

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
      emitter.end = (cb) => { emitter.terminated = true; cb && cb(null, 0, null); };
      return emitter;
    })
  };
}, { virtual: true });

const { PythonShell } = require('python-shell');
const ttsLocal = require('../src/plugins/tts/strategies/local');

describe('TTS 本地策略', () => {
  beforeEach(async () => { jest.clearAllMocks(); await ttsLocal.offline(); });

  test('online 會啟動 PythonShell', async () => {
    await ttsLocal.online({ pythonPath: 'p' });
    expect(PythonShell).toHaveBeenCalled();
  });

  test('send 會透過 PythonShell 傳遞資料', async () => {
    await ttsLocal.online({});
    const inst = PythonShell.mock.results[0].value;
    ttsLocal.send('hello');
    expect(inst.send).toHaveBeenCalledWith('hello');
  });

  test('offline 會結束 PythonShell', async () => {
    await ttsLocal.online({});
    const inst = PythonShell.mock.results[0].value;
    const endSpy = jest.spyOn(inst, 'end');
    await ttsLocal.offline();
    expect(endSpy).toHaveBeenCalled();
  });
});
