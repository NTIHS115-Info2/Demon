const axios = require('axios');
const { EventEmitter } = require('events');
jest.mock('axios');

const llamaRemote = require('../../src/plugins/llamaServer/strategies/remote');

describe('LlamaServer 遠端策略', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('online 之後 state 應為 1', async () => {
    await llamaRemote.online({ baseUrl: 'http://host' });
    expect(await llamaRemote.state()).toBe(1);
  });

  test('send 會處理串流資料', async () => {
    const stream = new EventEmitter();
    axios.mockResolvedValue({ data: stream });

    await llamaRemote.online({ baseUrl: 'http://host' });
    const emitter = await llamaRemote.send([]);

    const chunks = [];
    emitter.on('data', t => chunks.push(t));

    stream.emit('data', 'data: {"text":"a"}\n');
    stream.emit('data', 'data: {"text":"b"}\n');
    stream.emit('data', 'data: [DONE]\n');
    await new Promise(r => setImmediate(r));

    expect(chunks.join('')).toBe('ab');
  });
});
