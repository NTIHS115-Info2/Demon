const axios = require('axios');
jest.mock('axios');

const ttsRemote = require('../src/plugins/tts/strategies/remote');

describe('TTS 遠端策略', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('online 與 offline 正常執行', async () => {
    await expect(ttsRemote.online({ baseUrl: 'http://host' })).resolves.toBe(true);
    await expect(ttsRemote.offline()).resolves.toBe(true);
  });

  test('send 會傳送文字', async () => {
    axios.post.mockResolvedValue({});
    await ttsRemote.online({ baseUrl: 'http://host' });
    await ttsRemote.send('hi');
    expect(axios.post).toHaveBeenCalledWith('http://host/tts/send', { text: 'hi' });
  });

  test('state 根據 baseUrl 決定是否啟用', async () => {
    await ttsRemote.online({ baseUrl: 'http://host' });
    expect(await ttsRemote.state()).toBe(1);
    await ttsRemote.offline();
    expect(await ttsRemote.state()).toBe(0);
  });
});
