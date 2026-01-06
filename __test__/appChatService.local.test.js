const { EventEmitter } = require('events');

// 模擬 logger，避免測試時輸出大量日誌
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

describe('appChatService Local Strategy', () => {
  let strategy;
  let mockTalker;
  let mockPluginsManager;
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // 建立 mock talker（EventEmitter）
    mockTalker = new EventEmitter();
    mockTalker.talk = jest.fn();
    mockTalker.stop = jest.fn();

    // 建立 mock pluginsManager
    mockPluginsManager = {
      send: jest.fn()
    };

    // Mock 相依模組
    jest.doMock('../src/core/TalkToDemon.js', () => mockTalker);
    jest.doMock('../src/core/pluginsManager', () => mockPluginsManager);

    // 載入策略
    strategy = require('../src/plugins/appChatService/strategies/local/index.js');

    // 建立 mock HTTP request/response 物件
    mockRequest = {
      method: 'POST',
      params: ['chat'],
      body: {},
      is: jest.fn((contentType) => contentType === 'application/json')
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('online()', () => {
    it('應該成功註冊子網域並回傳 true', async () => {
      mockPluginsManager.send.mockResolvedValue(true);

      const result = await strategy.online();

      expect(result).toBe(true);
      expect(mockPluginsManager.send).toHaveBeenCalledWith('ngrok', {
        action: 'register',
        subdomain: 'ios-app',
        handler: expect.any(Function)
      });
    });

    it('應該在已註冊時跳過重複啟動', async () => {
      mockPluginsManager.send.mockResolvedValue(true);

      await strategy.online();
      const result = await strategy.online();

      expect(result).toBe(true);
      expect(mockPluginsManager.send).toHaveBeenCalledTimes(1);
    });

    it('應該在註冊失敗時回傳 false', async () => {
      mockPluginsManager.send.mockResolvedValue(false);

      const result = await strategy.online();

      expect(result).toBe(false);
    });

    it('應該在發生錯誤時回傳 false', async () => {
      mockPluginsManager.send.mockRejectedValue(new Error('Network error'));

      const result = await strategy.online();

      expect(result).toBe(false);
    });
  });

  describe('offline()', () => {
    it('應該在未註冊時直接回傳 true', async () => {
      const result = await strategy.offline();

      expect(result).toBe(true);
      expect(mockPluginsManager.send).not.toHaveBeenCalled();
    });

    it('應該成功解除註冊並回傳 true', async () => {
      mockPluginsManager.send.mockResolvedValue(true);
      await strategy.online();

      mockPluginsManager.send.mockResolvedValue(true);
      const result = await strategy.offline();

      expect(result).toBe(true);
      expect(mockPluginsManager.send).toHaveBeenCalledWith('ngrok', {
        action: 'unregister',
        subdomain: 'ios-app'
      });
    });

    it('應該在解除註冊失敗時回傳 false 且不更新狀態', async () => {
      mockPluginsManager.send.mockResolvedValue(true);
      await strategy.online();

      mockPluginsManager.send.mockResolvedValue(false);
      const result = await strategy.offline();

      expect(result).toBe(false);
      // 再次呼叫 offline 應該仍會嘗試解除註冊（狀態未更新）
      await strategy.offline();
      expect(mockPluginsManager.send).toHaveBeenCalledTimes(3); // 1 online + 2 offline
    });

    it('應該在發生錯誤時回傳 false 且不更新狀態', async () => {
      mockPluginsManager.send.mockResolvedValue(true);
      await strategy.online();

      mockPluginsManager.send.mockRejectedValue(new Error('Network error'));
      const result = await strategy.offline();

      expect(result).toBe(false);
    });
  });

  describe('restart()', () => {
    it('應該先離線再上線', async () => {
      mockPluginsManager.send.mockResolvedValue(true);

      const result = await strategy.restart();

      expect(result).toBe(true);
      expect(mockPluginsManager.send).toHaveBeenCalledTimes(1); // 只有 online（因為 offline 時未註冊）
    });
  });

  describe('state()', () => {
    it('應該在未註冊時回傳 0', async () => {
      const result = await strategy.state();

      expect(result).toBe(0);
    });

    it('應該在已註冊時回傳 1', async () => {
      mockPluginsManager.send.mockResolvedValue(true);
      await strategy.online();

      const result = await strategy.state();

      expect(result).toBe(1);
    });
  });

  describe('HTTP Request Handler', () => {
    let handler;

    beforeEach(async () => {
      mockPluginsManager.send.mockImplementation((plugin, options) => {
        if (options.action === 'register') {
          handler = options.handler;
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      });

      await strategy.online();
    });

    it('應該拒絕非 POST 請求', async () => {
      mockRequest.method = 'GET';

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '找不到該路徑。'
      });
    });

    it('應該拒絕非 JSON Content-Type', async () => {
      mockRequest.is.mockReturnValue(false);

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(415);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '不支援的 Content-Type，請使用 application/json。'
      });
    });

    it('應該拒絕空的 username', async () => {
      mockRequest.body = { username: '', message: 'Hello' };

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '欄位 username 和 message 不可為空。'
      });
    });

    it('應該拒絕空的 message', async () => {
      mockRequest.body = { username: 'user', message: '' };

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('應該拒絕缺少欄位', async () => {
      mockRequest.body = { username: 'user' };

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('應該拒絕過長的 username', async () => {
      mockRequest.body = {
        username: 'a'.repeat(101),
        message: 'Hello'
      };

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'username 長度不可超過 100 字元。'
      });
    });

    it('應該拒絕過長的 message', async () => {
      mockRequest.body = {
        username: 'user',
        message: 'a'.repeat(10001)
      };

      await handler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'message 長度不可超過 10000 字元。'
      });
    });

    it('應該正確處理 trim 空白字元', async () => {
      mockRequest.body = {
        username: '  user  ',
        message: '  Hello  '
      };

      // 模擬成功回應
      setImmediate(() => {
        mockTalker.emit('data', 'Response');
        mockTalker.emit('end');
      });

      await handler(mockRequest, mockResponse);

      // 等待非同步處理完成
      await new Promise(resolve => setImmediate(resolve));

      expect(mockTalker.talk).toHaveBeenCalledWith('user', 'Hello');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Response'
      });
    });

    it('應該成功處理有效請求並回傳回應', async () => {
      mockRequest.body = { username: 'user', message: 'Hello' };

      // 模擬 talker 回應
      setImmediate(() => {
        mockTalker.emit('data', 'Hi ');
        mockTalker.emit('data', 'there!');
        mockTalker.emit('end');
      });

      await handler(mockRequest, mockResponse);

      // 等待非同步處理完成
      await new Promise(resolve => setImmediate(resolve));

      expect(mockTalker.talk).toHaveBeenCalledWith('user', 'Hello');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Hi there!'
      });
    });

    it('應該處理 talker 錯誤', async () => {
      mockRequest.body = { username: 'user', message: 'Hello' };

      setImmediate(() => {
        mockTalker.emit('error', new Error('LLM failed'));
      });

      await handler(mockRequest, mockResponse);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '系統暫時無法處理，請稍後再試。'
      });
    });

    it('應該處理 talker 中止', async () => {
      mockRequest.body = { username: 'user', message: 'Hello' };

      setImmediate(() => {
        mockTalker.emit('abort');
      });

      await handler(mockRequest, mockResponse);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('應該依序處理並發請求，避免事件混淆', async () => {
      const request1 = {
        ...mockRequest,
        body: { username: 'user1', message: 'Message 1' }
      };
      const response1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };

      const request2 = {
        ...mockRequest,
        body: { username: 'user2', message: 'Message 2' }
      };
      const response2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };

      let talker1Called = false;
      let talker2Called = false;

      mockTalker.talk.mockImplementation((username) => {
        if (username === 'user1' && !talker1Called) {
          talker1Called = true;
          setImmediate(() => {
            mockTalker.emit('data', 'Response 1');
            mockTalker.emit('end');
          });
        } else if (username === 'user2' && !talker2Called) {
          talker2Called = true;
          setImmediate(() => {
            mockTalker.emit('data', 'Response 2');
            mockTalker.emit('end');
          });
        }
      });

      // 同時發送兩個請求
      const promise1 = handler(request1, response1);
      const promise2 = handler(request2, response2);

      await Promise.all([promise1, promise2]);

      // 等待所有非同步處理完成
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      // 驗證兩個請求都正確處理
      expect(response1.json).toHaveBeenCalledWith({ message: 'Response 1' });
      expect(response2.json).toHaveBeenCalledWith({ message: 'Response 2' });
      expect(mockTalker.talk).toHaveBeenCalledTimes(2);
    });

    it('應該處理 talker.talk() 同步拋出的錯誤', async () => {
      mockRequest.body = { username: 'user', message: 'Hello' };
      mockTalker.talk.mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      await handler(mockRequest, mockResponse);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '系統暫時無法處理，請稍後再試。'
      });
    });
  });

  describe('Priority', () => {
    it('應該匯出 priority 為 70', () => {
      expect(strategy.priority).toBe(70);
    });
  });
});
