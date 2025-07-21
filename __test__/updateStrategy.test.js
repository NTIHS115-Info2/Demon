const axios = require('axios');
jest.mock('axios');

const OsInfor = require('../src/tools/OsInfor');
jest.mock('../src/tools/OsInfor');

const tts = require('../src/plugins/tts');
const remote = require('../src/plugins/tts/strategies/remote');
const server = require('../src/plugins/tts/strategies/server');
const local = require('../src/plugins/tts/strategies/local');

describe('TTS updateStrategy 自動判定', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('remote 可用時優先選 remote', async () => {
    axios.get.mockResolvedValue({});
    OsInfor.table.mockResolvedValue({ platform: 'linux' });
    await tts.updateStrategy('auto', { baseUrl: 'http://host' });
    expect(tts.priority).toBe(remote.priority);
  });

  test('remote 不可用但符合 serverInfo 時選 server', async () => {
    axios.get.mockRejectedValue(new Error('fail'));
    OsInfor.table.mockResolvedValue({ platform: 'linux' });
    await tts.updateStrategy('auto', {});
    expect(tts.priority).toBe(server.priority);
  });

  test('remote 與 server 都不可用時選 local', async () => {
    axios.get.mockRejectedValue(new Error('fail'));
    OsInfor.table.mockResolvedValue({ platform: 'unknown' });
    await tts.updateStrategy('auto', {});
    expect(tts.priority).toBe(local.priority);
  });

  test('外部傳入權重可調整優先序', async () => {
    axios.get.mockRejectedValue(new Error('fail'));
    OsInfor.table.mockResolvedValue({ platform: 'linux' });
    await tts.updateStrategy('auto', { weights: { server: 5, remote: 1 } });
    expect(tts.priority).toBe(server.priority);
  });
});
