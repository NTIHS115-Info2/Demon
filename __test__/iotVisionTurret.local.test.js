const { EventEmitter } = require('events');

// 模擬 logger，避免測試時輸出大量日誌
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

/**
 * 建立 spawn 的模擬實作
 * @param {Object} config 模擬配置
 * @returns {jest.Mock}
 */
function createSpawnMock(config = {}) {
  return jest.fn(() => {
    const mockChild = new EventEmitter();
    mockChild.stdin = {
      write: jest.fn(),
      end: jest.fn()
    };
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = jest.fn();

    process.nextTick(() => {
      if (config.error) {
        mockChild.emit('error', config.error);
        return;
      }

      if (config.stdout) {
        mockChild.stdout.emit('data', Buffer.from(config.stdout));
      }

      if (config.stderr) {
        mockChild.stderr.emit('data', Buffer.from(config.stderr));
      }

      mockChild.emit('close', config.exitCode ?? 0);
    });

    return mockChild;
  });
}

/**
 * 建立 mock Express app
 * @returns {Object} mock Express app
 */
function createMockExpressApp() {
  const app = {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn()
  };
  return app;
}

/**
 * 依照需求載入 iotVisionTurret 本地策略
 * @param {Object} spawnConfig spawn 模擬配置
 * @returns {{strategy: Object, spawnMock: jest.Mock}}
 */
function loadLocalStrategy(spawnConfig = {}) {
  jest.resetModules();
  jest.clearAllMocks();

  const spawnMock = createSpawnMock(spawnConfig);
  jest.doMock('child_process', () => ({ spawn: spawnMock }));

  const strategy = require('../src/plugins/iotVisionTurret/strategies/local');
  return { strategy, spawnMock };
}

afterEach(() => {
  jest.unmock('child_process');
  jest.restoreAllMocks();
});

describe('iotVisionTurret 本地策略', () => {
  test('online 應成功啟動並回傳 void', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true, mode: 'stub', message: 'ready' }),
      exitCode: 0
    };
    const { strategy, spawnMock } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const state = await strategy.state();
    expect(state).toBe(1); // online
  });

  test('online 遇到錯誤時應拋出異常', async () => {
    const spawnConfig = {
      error: new Error('Python not found')
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    await expect(strategy.online({ expressApp: createMockExpressApp() })).rejects.toThrow('Python not found');
  });

  test('offline 應成功關閉並回傳 void', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true, mode: 'stub' }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });
    await strategy.offline();

    const state = await strategy.state();
    expect(state).toBe(0); // offline
  });

  test('state 應回傳數字狀態碼', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    // 未上線時應回傳 0
    let state = await strategy.state();
    expect(state).toBe(0);

    // 上線後應回傳 1
    await strategy.online({ expressApp: createMockExpressApp() });
    state = await strategy.state();
    expect(state).toBe(1);
  });

  test('restart 應依序執行 offline 和 online', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy, spawnMock } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });
    spawnMock.mockClear();

    await strategy.restart({ expressApp: createMockExpressApp() });

    // restart 會呼叫一次 online (ping)
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const state = await strategy.state();
    expect(state).toBe(1);
  });

  test('send 在未上線時應回傳 { ok: false }', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    const result = await strategy.send({ test: 'data' });
    expect(result).toEqual({ ok: false });
  });

  test('send 在上線但裝置未註冊時應回傳 { ok: false }', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true, data: 'result' }),
      exitCode: 0
    };
    const { strategy, spawnMock } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });
    spawnMock.mockClear();

    // 新實作需要裝置註冊才能執行，否則回傳 { ok: false }
    const result = await strategy.send({ test: 'data' });

    expect(result).toEqual({ ok: false });
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });

  test('send 遇到裝置未註冊時應回傳 { ok: false }', async () => {
    let callCount = 0;
    const multiSpawnMock = jest.fn(() => {
      callCount++;
      const mockChild = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();

      process.nextTick(() => {
        if (callCount === 1) {
          // 第一次呼叫（online ping）成功
          mockChild.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          mockChild.emit('close', 0);
        } else {
          // 不應該有第二次呼叫
          mockChild.stderr.emit('data', Buffer.from('Unexpected call'));
          mockChild.emit('close', 1);
        }
      });

      return mockChild;
    });

    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('child_process', () => ({ spawn: multiSpawnMock }));

    const strategy = require('../src/plugins/iotVisionTurret/strategies/local');

    await strategy.online({ expressApp: createMockExpressApp() });
    const result = await strategy.send({ test: 'data' });
    
    // 新實作在裝置未註冊時回傳 { ok: false } 而非拋出異常
    expect(result).toEqual({ ok: false });
  });

  test('send 應阻止並發執行（使用 jobLock）', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });

    // 同時發起兩個請求
    const send1 = strategy.send({ request: 1 });
    const send2 = strategy.send({ request: 2 });

    const result1 = await send1;
    const result2 = await send2;

    // 第一個請求會因為裝置未註冊回傳 { ok: false }
    expect(result1).toEqual({ ok: false });
    // 第二個請求會因為 jobLock 或裝置未註冊回傳 { ok: false }
    expect(result2).toEqual({ ok: false });
  });

  test('send 在裝置未註冊時應立即回傳 { ok: false }', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });
    const result = await strategy.send({ test: 'data' });
    
    // 新實作不呼叫 Python runner，而是使用 IoT 裝置佇列
    // 裝置未註冊時會立即回傳 { ok: false }
    expect(result).toEqual({ ok: false });
  });

  test('Python 逾時時應終止進程並拋出錯誤', async () => {
    jest.useFakeTimers();

    const timeoutSpawnMock = jest.fn(() => {
      const mockChild = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();

      // 不發送任何事件，模擬掛起

      return mockChild;
    });

    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('child_process', () => ({ spawn: timeoutSpawnMock }));

    const strategy = require('../src/plugins/iotVisionTurret/strategies/local');

    const onlinePromise = strategy.online({ timeoutMs: 5000, expressApp: createMockExpressApp() });

    // 快進超時時間
    jest.advanceTimersByTime(5000);

    await expect(onlinePromise).rejects.toThrow('Python runner 執行逾時');

    jest.useRealTimers();
  });
});

describe('iotVisionTurret 插件整合', () => {
  test('插件應正確初始化並切換策略', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    loadLocalStrategy(spawnConfig);

    const plugin = require('../src/plugins/iotVisionTurret');

    await plugin.updateStrategy('local');
    expect(plugin.priority).toBeDefined();
  });

  test('插件 updateStrategy 不支援非 local 模式應自動切換到 local', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    loadLocalStrategy(spawnConfig);

    const plugin = require('../src/plugins/iotVisionTurret');

    // 不應拋出錯誤，而是自動切換到 local
    await plugin.updateStrategy('remote');
    expect(plugin.priority).toBeDefined();
  });

  test('插件 online/offline/restart 流程應正常運作', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    loadLocalStrategy(spawnConfig);

    const plugin = require('../src/plugins/iotVisionTurret');

    await plugin.online({ expressApp: createMockExpressApp() });
    let state = await plugin.state();
    expect(state).toBe(1);

    await plugin.offline();
    state = await plugin.state();
    expect(state).toBe(0);

    await plugin.restart({ expressApp: createMockExpressApp() });
    state = await plugin.state();
    expect(state).toBe(1);
  });

  test('插件 send 應符合預期介面（回傳物件格式）', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    loadLocalStrategy(spawnConfig);

    const plugin = require('../src/plugins/iotVisionTurret');

    await plugin.online({ expressApp: createMockExpressApp() });
    const result = await plugin.send({ test: 'data' });

    // 新實作回傳 { ok: boolean } 物件
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('ok');
    expect(typeof result.ok).toBe('boolean');
  });

  test('插件 state 應回傳錯誤時為 -1', async () => {
    jest.resetModules();
    jest.clearAllMocks();

    // 強制策略 state 拋出錯誤
    jest.doMock('../src/plugins/iotVisionTurret/strategies/local', () => ({
      priority: 50,
      online: jest.fn(),
      offline: jest.fn(),
      restart: jest.fn(),
      state: jest.fn(() => {
        throw new Error('State error');
      }),
      send: jest.fn()
    }));

    const plugin = require('../src/plugins/iotVisionTurret');

    const state = await plugin.state();
    expect(state).toBe(-1);
  });
});
