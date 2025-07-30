// Mock express request/response objects
const mockRequest = (params = {}) => ({
  params,
  body: {},
  headers: {}
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  res.headersSent = false;
  return res;
};

// Mock local strategy
const mockLocal = {
  online: jest.fn(),
  offline: jest.fn(),
  restart: jest.fn(),
  state: jest.fn()
};

jest.mock('../src/plugins/asr/strategies/local', () => mockLocal);

// Mock plugins manager
const mockPluginsManager = {
  send: jest.fn()
};

jest.mock('../src/core/pluginsManager', () => mockPluginsManager);

// Mock Logger
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

const asrServer = require('../src/plugins/asr/strategies/server');

describe('ASR Server 策略錯誤處理測試', () => {
  let handler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLocal.online.mockResolvedValue(true);
    mockLocal.offline.mockResolvedValue(true);
    mockLocal.restart.mockResolvedValue(true);
    mockLocal.state.mockResolvedValue(1);
    
    // Capture the handler function
    mockPluginsManager.send.mockImplementation((plugin, config) => {
      if (plugin === 'ngrok' && config.action === 'register') {
        handler = config.handler;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });

    await asrServer.online({});
  });

  afterEach(async () => {
    await asrServer.offline();
  });

  describe('HTTP 路由錯誤處理', () => {
    test('start 路由成功執行應回傳 200 和詳細信息', async () => {
      const req = mockRequest({ action: 'start' });
      const res = mockResponse();

      await handler(req, res);

      expect(mockLocal.online).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'ASR 已啟動',
          duration_ms: expect.any(Number)
        })
      );
    });

    test('stop 路由成功執行應回傳 200 和詳細信息', async () => {
      const req = mockRequest({ action: 'stop' });
      const res = mockResponse();

      await handler(req, res);

      expect(mockLocal.offline).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'ASR 已停止',
          duration_ms: expect.any(Number)
        })
      );
    });

    test('state 路由應回傳狀態和時間戳', async () => {
      const req = mockRequest({ action: 'state' });
      const res = mockResponse();

      await handler(req, res);

      expect(mockLocal.state).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 1,
          duration_ms: expect.any(Number),
          timestamp: expect.any(String)
        })
      );
    });

    test('未知操作應回傳 404 和可用操作列表', async () => {
      const req = mockRequest({ action: 'unknown' });
      const res = mockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: '未找到操作',
          message: '未知的 ASR 操作：unknown',
          available_actions: ['start', 'stop', 'restart', 'state']
        })
      );
    });

    test('操作執行失敗應回傳 500 錯誤', async () => {
      const error = new Error('本地服務無法啟動');
      mockLocal.online.mockRejectedValueOnce(error);

      const req = mockRequest({ action: 'start' });
      const res = mockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'internal_error',
          message: '本地服務無法啟動',
          action: 'start',
          duration_ms: expect.any(Number),
          timestamp: expect.any(String)
        })
      );
    });

    test('連線錯誤應回傳 500 和連線錯誤類型', async () => {
      const error = new Error('ECONNREFUSED 127.0.0.1:8080');
      mockLocal.restart.mockRejectedValueOnce(error);

      const req = mockRequest({ action: 'restart' });
      const res = mockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'connection_error',
          message: '無法連接到本地 ASR 服務',
          action: 'restart'
        })
      );
    });

    test('超時錯誤應回傳 408 狀態碼', async () => {
      const error = new Error('操作逾時');
      mockLocal.state.mockRejectedValueOnce(error);

      const req = mockRequest({ action: 'state' });
      const res = mockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(408);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'timeout_error',
          message: '操作逾時',
          action: 'state'
        })
      );
    });

    test('長時間運行的操作有超時保護機制', async () => {
      // 模擬一個長時間運行的操作
      mockLocal.online.mockImplementation(() => {
        return new Promise((resolve) => {
          // 模擬一個永遠不會解決的 Promise
          // 但我們的超時機制應該處理這種情況
        });
      });

      const req = mockRequest({ action: 'start' });
      const res = mockResponse();

      // 確認 setTimeout 被調用來設置超時
      const originalSetTimeout = global.setTimeout;
      const timeoutSpy = jest.spyOn(global, 'setTimeout');
      
      const handlerPromise = handler(req, res);
      
      // 驗證超時設置被調用
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
      
      // 恢復 setTimeout
      global.setTimeout = originalSetTimeout;
      timeoutSpy.mockRestore();
    }, 1000);
  });
});