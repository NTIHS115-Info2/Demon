const axios = require('axios');
jest.mock('axios');

const asrRemote = require('../src/plugins/asr/strategies/remote');

describe('ASR 遠端策略', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('online 與 offline 應正常執行', async () => {
    await expect(asrRemote.online({ baseUrl: 'http://host/' })).resolves.toBe(true);
    axios.get.mockRejectedValue(new Error('fail'));
    await asrRemote.state();
    await expect(asrRemote.offline()).resolves.toBe(true);
  });

  test('state 會向遠端查詢並回傳狀態', async () => {
    axios.get.mockResolvedValue({ data: { state: 3 } });
    await asrRemote.online({ baseUrl: 'http://host' });
    const state = await asrRemote.state();
    expect(axios.get).toHaveBeenCalledWith('http://host/asr/state');
    expect(state).toBe(3);
  });

  test('send 會根據 action 發送指令', async () => {
    axios.post.mockResolvedValue({ data: 'ok' });
    await asrRemote.online({ baseUrl: 'http://host' });
    const res = await asrRemote.send('start');
    expect(axios.post).toHaveBeenCalledWith('http://host/asr/start');
    expect(res).toBe('ok');
  });
});
