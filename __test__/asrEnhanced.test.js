const axios = require('axios');

// Mock axios for testing timeout and error scenarios
jest.mock('axios');
const mockedAxios = axios;

// Mock Logger
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

// Mock server info
jest.mock('../src/plugins/asr/strategies/server/infor', () => ({
  subdomain: 'asr',
  routes: {
    start: 'start',
    stop: 'stop',
    restart: 'restart',
    state: 'state'
  },
  serverInfo: {
    platform: 'linux'
  }
}));

const asrMain = require('../src/plugins/asr');
const asrRemote = require('../src/plugins/asr/strategies/remote');

describe('ASR 增強功能測試', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockClear();
    mockedAxios.post.mockClear();
  });

  describe('Remote 策略超時處理', () => {
    test('state 查詢超時應返回 -1', async () => {
      // 模擬超時錯誤
      mockedAxios.get.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded'
      });

      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      const result = await asrRemote.state();
      
      expect(result).toBe(-1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://test.example.com/asr/state',
        expect.objectContaining({
          timeout: 5000,
          headers: expect.objectContaining({
            'User-Agent': 'Demon-ASR-Remote/1.0.0'
          })
        })
      );
    });

    test('send 指令超時應拋出錯誤', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded'
      });

      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      
      await expect(asrRemote.send('start')).rejects.toThrow('遠端伺服器回應逾時');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test.example.com/asr/start',
        {},
        expect.objectContaining({
          timeout: 10000,
          headers: expect.objectContaining({
            'User-Agent': 'Demon-ASR-Remote/1.0.0'
          })
        })
      );
    });

    test('send 指令遇到 500 錯誤應正確處理', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 500,
        statusText: 'Internal Server Error',
        data: null
      });

      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      
      await expect(asrRemote.send('start')).rejects.toThrow('遠端伺服器內部錯誤 (HTTP 500)');
    });

    test('send 指令遇到連線拒絕應正確處理', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:8080'
      });

      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      
      await expect(asrRemote.send('start')).rejects.toThrow('無法連接到遠端伺服器');
    });

    test('send 指令成功執行應記錄執行時間', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { success: true }
      });

      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      const result = await asrRemote.send('start');
      
      expect(result).toEqual({ success: true });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test.example.com/asr/start',
        {},
        expect.objectContaining({
          timeout: 10000,
          validateStatus: expect.any(Function)
        })
      );
    });
  });

  describe('主插件策略選擇增強', () => {
    test('remote 連線超時應選擇下一個策略', async () => {
      // Mock OsInfor for server strategy detection
      const mockOsInfor = {
        table: jest.fn().mockResolvedValue({ platform: 'linux' })
      };
      jest.doMock('../src/tools/OsInfor', () => mockOsInfor);

      mockedAxios.get.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 3000ms exceeded'
      });

      await asrMain.updateStrategy('auto', { 
        baseUrl: 'http://test.example.com',
        weights: { remote: 3, server: 2, local: 1 }
      });

      // 由於 remote 超時，應該選擇 server 策略
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://test.example.com',
        expect.objectContaining({
          timeout: 3000,
          headers: expect.objectContaining({
            'User-Agent': 'Demon-ASR/1.0.0'
          })
        })
      );
    });
  });

  describe('錯誤處理和日誌記錄', () => {
    test('未知指令應拋出正確錯誤', async () => {
      await asrRemote.online({ baseUrl: 'http://test.example.com' });
      
      await expect(asrRemote.send('unknown')).rejects.toThrow('未知的指令: unknown');
    });

    test('未初始化時執行 send 應拋出錯誤', async () => {
      // 重置 remote 策略
      await asrRemote.offline();
      
      await expect(asrRemote.send('start')).rejects.toThrow('遠端未初始化');
    });
  });
});