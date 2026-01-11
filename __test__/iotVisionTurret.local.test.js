const { spawn } = require('child_process');
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

  test('send 在未上線時應拋出錯誤', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    const { strategy } = loadLocalStrategy(spawnConfig);

    await expect(strategy.send({ test: 'data' })).rejects.toThrow('iotVisionTurret 尚未上線');
  });

  test('send 在上線後應成功傳送並回傳 true', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true, data: 'result' }),
      exitCode: 0
    };
    const { strategy, spawnMock } = loadLocalStrategy(spawnConfig);

    await strategy.online({ expressApp: createMockExpressApp() });
    spawnMock.mockClear();

    const result = await strategy.send({ test: 'data' });

    expect(result).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test('send 遇到 Python 執行錯誤時應拋出異常', async () => {
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
          // 第二次呼叫（send infer）失敗
          mockChild.stderr.emit('data', Buffer.from('Python error'));
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
    await expect(strategy.send({ test: 'data' })).rejects.toThrow();
  });

  test('send 應阻止並發執行（等待前一個完成）', async () => {
    let resolveFirst;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    let callCount = 0;
    const delayedSpawnMock = jest.fn(() => {
      callCount++;
      const mockChild = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();

      if (callCount === 1) {
        // 第一次呼叫（online）立即完成
        process.nextTick(() => {
          mockChild.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          mockChild.emit('close', 0);
        });
      } else if (callCount === 2) {
        // 第二次呼叫（第一個 send）延遲
        firstPromise.then(() => {
          mockChild.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          mockChild.emit('close', 0);
        });
      } else {
        // 第三次呼叫（第二個 send）立即完成
        process.nextTick(() => {
          mockChild.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          mockChild.emit('close', 0);
        });
      }

      return mockChild;
    });

    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('child_process', () => ({ spawn: delayedSpawnMock }));

    const strategy = require('../src/plugins/iotVisionTurret/strategies/local');

    await strategy.online({ expressApp: createMockExpressApp() });
    delayedSpawnMock.mockClear();

    // 同時發起兩個請求
    const send1 = strategy.send({ request: 1 });
    const send2 = strategy.send({ request: 2 });

    // 第二個請求應等待第一個
    expect(delayedSpawnMock).toHaveBeenCalledTimes(1);

    // 完成第一個請求
    resolveFirst();
    await send1;

    // 第二個請求現在應該開始
    await send2;
    expect(delayedSpawnMock).toHaveBeenCalledTimes(2);
  });

  test('Python 回傳非法 JSON 時應拋出錯誤', async () => {
    let callCount = 0;
    const badJsonSpawnMock = jest.fn(() => {
      callCount++;
      const mockChild = new EventEmitter();
      mockChild.stdin = { write: jest.fn(), end: jest.fn() };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();

      process.nextTick(() => {
        if (callCount === 1) {
          mockChild.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          mockChild.emit('close', 0);
        } else {
          mockChild.stdout.emit('data', Buffer.from('not valid json'));
          mockChild.emit('close', 0);
        }
      });

      return mockChild;
    });

    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('child_process', () => ({ spawn: badJsonSpawnMock }));

    const strategy = require('../src/plugins/iotVisionTurret/strategies/local');

    await strategy.online({ expressApp: createMockExpressApp() });
    await expect(strategy.send({ test: 'data' })).rejects.toThrow('JSON 解析失敗');
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

  test('插件 send 應符合預期介面', async () => {
    const spawnConfig = {
      stdout: JSON.stringify({ ok: true }),
      exitCode: 0
    };
    loadLocalStrategy(spawnConfig);

    const plugin = require('../src/plugins/iotVisionTurret');

    await plugin.online({ expressApp: createMockExpressApp() });
    const result = await plugin.send({ test: 'data' });

    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
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
