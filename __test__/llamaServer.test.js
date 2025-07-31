const LlamaServerPlugin = require('../src/plugins/llamaServer');
const pluginsManager = require('../src/core/pluginsManager');

// Mock axios to prevent actual HTTP calls
jest.mock('axios');
const axios = require('axios');

// Mock the LlamaServerManager to prevent spawning actual processes
jest.mock('../Server/llama/llamaServer', () => {
  let isRunning = false;
  return jest.fn().mockImplementation(() => ({
    startWithPreset: jest.fn().mockImplementation(() => {
      isRunning = true;
      return Promise.resolve(true);
    }),
    stop: jest.fn().mockImplementation(() => {
      isRunning = false;
      return Promise.resolve(true);
    }),
    restartWithPreset: jest.fn().mockImplementation(() => {
      isRunning = true;
      return Promise.resolve(true);
    }),
    isRunning: jest.fn().mockImplementation(() => isRunning)
  }));
});

// Mock the ngrok plugin functionality
jest.mock('../src/core/pluginsManager', () => ({
  send: jest.fn()
}));

describe('LlamaServer Plugin - 三模式切換測試', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await LlamaServerPlugin.offline();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('模式切換功能 (Three-mode switching)', () => {
    test('應該支援切換到 local 模式', async () => {
      await LlamaServerPlugin.updateStrategy('local');
      const state = await LlamaServerPlugin.state();
      
      // Should be able to switch to local mode
      expect(typeof state).toBe('number');
    });

    test('應該支援切換到 remote 模式', async () => {
      await LlamaServerPlugin.updateStrategy('remote');
      const state = await LlamaServerPlugin.state();
      
      expect(typeof state).toBe('number');
    });

    test('應該支援切換到 server 模式', async () => {
      await LlamaServerPlugin.updateStrategy('server');
      const state = await LlamaServerPlugin.state();
      
      expect(typeof state).toBe('number');
    });
  });

  describe('online/offline/state/abort 行為驗證', () => {
    test('local 模式 - online/offline/state 流程', async () => {
      await LlamaServerPlugin.updateStrategy('local');
      
      // Test online
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      // Test state
      const onlineState = await LlamaServerPlugin.state();
      expect(onlineState).toBe(1); // Should be online
      
      // Test offline
      await LlamaServerPlugin.offline();
      
      const offlineState = await LlamaServerPlugin.state();
      expect([0, -1]).toContain(offlineState); // Should be offline or error
    });

    test('remote 模式 - online/offline/state 流程', async () => {
      await LlamaServerPlugin.updateStrategy('remote');
      
      // Test online with baseUrl
      await LlamaServerPlugin.online({ baseUrl: 'http://test.ngrok.io' });
      
      // Test state
      const onlineState = await LlamaServerPlugin.state();
      expect(onlineState).toBe(1); // Should be online
      
      // Test offline
      await LlamaServerPlugin.offline();
      
      const offlineState = await LlamaServerPlugin.state();
      expect(offlineState).toBe(0); // Should be offline
    });

    test('server 模式 - online/offline/state 流程', async () => {
      // Mock ngrok plugin response
      pluginsManager.send.mockResolvedValue(true);
      
      await LlamaServerPlugin.updateStrategy('server');
      
      // Test online
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      // Test state
      const onlineState = await LlamaServerPlugin.state();
      expect(onlineState).toBe(1); // Should be online
      
      // Test offline
      await LlamaServerPlugin.offline();
      
      // Verify ngrok unregister was called
      expect(pluginsManager.send).toHaveBeenCalledWith('ngrok', {
        action: 'unregister',
        subdomain: 'llama'
      });
    });

    test('abort 功能測試', async () => {
      const EventEmitter = require('events');
      const mockStream = new EventEmitter();
      mockStream.destroy = jest.fn();
      
      // Mock axios to return a stream response
      axios.mockResolvedValue({
        data: mockStream
      });
      
      await LlamaServerPlugin.updateStrategy('local');
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      // Start a send operation
      const emitter = await LlamaServerPlugin.send([
        { role: 'user', content: 'test message' }
      ]);
      
      expect(emitter).toBeDefined();
      expect(typeof emitter.abort).toBe('function');
      
      // Test abort functionality
      let abortTriggered = false;
      emitter.on('abort', () => {
        abortTriggered = true;
      });
      
      // Wait a bit for the stream setup
      await new Promise(resolve => setTimeout(resolve, 10));
      
      emitter.abort();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(abortTriggered).toBe(true);
      expect(mockStream.destroy).toHaveBeenCalled();
    });
  });

  describe('串流 EventEmitter 收發與中止', () => {
    test('串流數據正常接收', async () => {
      const EventEmitter = require('events');
      const mockStream = new EventEmitter();
      
      axios.mockResolvedValue({
        data: mockStream
      });
      
      await LlamaServerPlugin.updateStrategy('local');
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      const emitter = await LlamaServerPlugin.send([
        { role: 'user', content: 'Hello' }
      ]);
      
      const receivedData = [];
      emitter.on('data', (text) => {
        receivedData.push(text);
      });
      
      let endTriggered = false;
      emitter.on('end', () => {
        endTriggered = true;
      });
      
      // Simulate streaming data
      mockStream.emit('data', 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n');
      mockStream.emit('data', 'data: {"choices":[{"delta":{"content":" World"}}]}\n');
      mockStream.emit('data', 'data: [DONE]\n');
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(receivedData.join('')).toBe('Hello World');
      expect(endTriggered).toBe(true);
    });

    test('串流中止功能', async () => {
      const EventEmitter = require('events');
      const mockStream = new EventEmitter();
      mockStream.destroy = jest.fn();
      
      axios.mockResolvedValue({
        data: mockStream
      });
      
      await LlamaServerPlugin.updateStrategy('local');
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      const emitter = await LlamaServerPlugin.send([
        { role: 'user', content: 'test' }
      ]);
      
      let abortTriggered = false;
      emitter.on('abort', () => {
        abortTriggered = true;
      });
      
      // Abort the stream
      emitter.abort();
      
      expect(mockStream.destroy).toHaveBeenCalled();
      expect(abortTriggered).toBe(true);
    });

    test('錯誤處理', async () => {
      const EventEmitter = require('events');
      const mockStream = new EventEmitter();
      
      axios.mockResolvedValue({
        data: mockStream
      });
      
      await LlamaServerPlugin.updateStrategy('local');
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      const emitter = await LlamaServerPlugin.send([
        { role: 'user', content: 'test' }
      ]);
      
      let errorReceived = null;
      emitter.on('error', (error) => {
        errorReceived = error;
      });
      
      const testError = new Error('Test error');
      mockStream.emit('error', testError);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(errorReceived).toBe(testError);
    });
  });

  describe('資源釋放與多重啟動衝突', () => {
    test('重複啟動應該正確處理', async () => {
      await LlamaServerPlugin.updateStrategy('local');
      
      // First startup
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      const state1 = await LlamaServerPlugin.state();
      
      // Second startup (should handle gracefully)
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      const state2 = await LlamaServerPlugin.state();
      
      expect(state1).toBe(1);
      expect(state2).toBe(1);
    });

    test('restart 應該正確清理資源', async () => {
      await LlamaServerPlugin.updateStrategy('local');
      
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      const stateBefore = await LlamaServerPlugin.state();
      
      await LlamaServerPlugin.restart({ preset: 'exclusive' });
      const stateAfter = await LlamaServerPlugin.state();
      
      expect(stateBefore).toBe(1);
      expect(stateAfter).toBe(1);
    });

    test('模式切換時應該清理前一個模式的資源', async () => {
      // Start with local mode
      await LlamaServerPlugin.updateStrategy('local');
      await LlamaServerPlugin.online({ preset: 'exclusive' });
      
      // Switch to remote mode
      await LlamaServerPlugin.updateStrategy('remote');
      await LlamaServerPlugin.online({ baseUrl: 'http://test.ngrok.io' });
      
      const finalState = await LlamaServerPlugin.state();
      expect(finalState).toBe(1);
    });
  });
});

describe('ngrok 公開 URL 與 SSE 介面測試', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('server 模式應該註冊 ngrok 子網域', async () => {
    pluginsManager.send.mockResolvedValue(true);
    
    await LlamaServerPlugin.updateStrategy('server');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    // Verify ngrok registration was called
    expect(pluginsManager.send).toHaveBeenCalledWith('ngrok', {
      action: 'register',
      subdomain: 'llama',
      handler: expect.any(Function)
    });
  });

  test('SSE 介面處理請求', async () => {
    pluginsManager.send.mockResolvedValue(true);
    
    await LlamaServerPlugin.updateStrategy('server');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    // Get the handler that was registered
    const registerCall = pluginsManager.send.mock.calls.find(
      call => call[0] === 'ngrok' && call[1].action === 'register'
    );
    
    expect(registerCall).toBeDefined();
    const handler = registerCall[1].handler;
    expect(typeof handler).toBe('function');
    
    // Mock request/response objects
    const mockReq = {
      method: 'POST',
      params: { action: 'send' },
      body: { messages: [{ role: 'user', content: 'test' }] }
    };
    
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    
    // Test the handler
    await handler(mockReq, mockRes);
    
    // Verify SSE headers were set
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
  });

  test('server 模式關閉時應該解除註冊', async () => {
    pluginsManager.send.mockResolvedValue(true);
    
    await LlamaServerPlugin.updateStrategy('server');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    // Clear previous calls and test offline
    jest.clearAllMocks();
    pluginsManager.send.mockResolvedValue(true);
    
    await LlamaServerPlugin.offline();
    
    expect(pluginsManager.send).toHaveBeenCalledWith('ngrok', {
      action: 'unregister',
      subdomain: 'llama'
    });
  });
});

describe('LlamaServer Plugin - 整合測試', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await LlamaServerPlugin.offline();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test('完整流程測試：模式切換 + 串流 + 中止', async () => {
    const EventEmitter = require('events');
    
    // 測試 local 模式
    await LlamaServerPlugin.updateStrategy('local');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    let localState = await LlamaServerPlugin.state();
    expect(localState).toBe(1);
    
    // 模擬串流請求
    const mockStream = new EventEmitter();
    mockStream.destroy = jest.fn();
    axios.mockResolvedValue({ data: mockStream });
    
    const emitter = await LlamaServerPlugin.send([
      { role: 'user', content: 'test message' }
    ]);
    
    const receivedData = [];
    emitter.on('data', text => receivedData.push(text));
    
    // 模擬串流數據
    mockStream.emit('data', 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n');
    mockStream.emit('data', 'data: {"choices":[{"delta":{"content":" World"}}]}\n');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(receivedData.join('')).toBe('Hello World');
    
    // 測試中止功能
    emitter.abort();
    expect(mockStream.destroy).toHaveBeenCalled();
    
    // 切換到 remote 模式
    await LlamaServerPlugin.updateStrategy('remote');
    await LlamaServerPlugin.online({ baseUrl: 'http://test.ngrok.io' });
    
    let remoteState = await LlamaServerPlugin.state();
    expect(remoteState).toBe(1);
    
    // 切換到 server 模式
    pluginsManager.send.mockResolvedValue(true);
    await LlamaServerPlugin.updateStrategy('server');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    let serverState = await LlamaServerPlugin.state();
    expect(serverState).toBe(1);
    
    // 驗證 ngrok 註冊
    expect(pluginsManager.send).toHaveBeenCalledWith('ngrok', {
      action: 'register',
      subdomain: 'llama',
      handler: expect.any(Function)
    });
    
    // 最終清理
    await LlamaServerPlugin.offline();
    let finalState = await LlamaServerPlugin.state();
    expect(finalState).toBe(0);
  });

  test('錯誤恢復測試', async () => {
    await LlamaServerPlugin.updateStrategy('remote');
    
    // 測試沒有 baseUrl 的錯誤情況
    await expect(LlamaServerPlugin.online())
      .rejects.toThrow('遠端模式需要提供 baseUrl');
    
    // 正確提供 baseUrl 後應該成功
    await expect(LlamaServerPlugin.online({ baseUrl: 'http://test.ngrok.io' }))
      .resolves.toBe(true);
    
    const state = await LlamaServerPlugin.state();
    expect(state).toBe(1);
  });

  test('併發請求處理', async () => {
    const EventEmitter = require('events');
    
    await LlamaServerPlugin.updateStrategy('local');
    await LlamaServerPlugin.online({ preset: 'exclusive' });
    
    // 模擬多個併發請求
    const mockStreams = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
    mockStreams.forEach(stream => { stream.destroy = jest.fn(); });
    
    let callCount = 0;
    axios.mockImplementation(() => {
      return Promise.resolve({ data: mockStreams[callCount++] });
    });
    
    const emitters = await Promise.all([
      LlamaServerPlugin.send([{ role: 'user', content: 'request 1' }]),
      LlamaServerPlugin.send([{ role: 'user', content: 'request 2' }]),
      LlamaServerPlugin.send([{ role: 'user', content: 'request 3' }])
    ]);
    
    expect(emitters).toHaveLength(3);
    emitters.forEach(emitter => {
      expect(typeof emitter.abort).toBe('function');
    });
    
    // 測試批量中止
    emitters.forEach(emitter => emitter.abort());
    mockStreams.forEach(stream => {
      expect(stream.destroy).toHaveBeenCalled();
    });
  });
});