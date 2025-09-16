const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// 模擬 logger，避免測試時輸出大量日誌
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

const TOKENS_DIR = path.join(__dirname, '..', 'tokens');
const TOKENS_FILE = path.join(TOKENS_DIR, 'cwa.js');

/**
 * 確保 tokens 目錄存在並建立對應檔案
 * @param {string} [apiKey]
 */
function safeWriteTokenFile(apiKey) {
  try {
    fs.mkdirSync(TOKENS_DIR, { recursive: true });
    const content = apiKey
      ? `module.exports = { CWA_API_KEY: '${apiKey}' };\n`
      : 'module.exports = {};\n';
    fs.writeFileSync(TOKENS_FILE, content, 'utf8');
  } catch (err) {
    throw new Error(`建立 tokens/cwa.js 失敗：${err.message}`);
  }
}

/**
 * 移除測試期間建立的 tokens 檔案
 */
function safeRemoveTokenFile() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      fs.unlinkSync(TOKENS_FILE);
    }
  } catch (err) {
    throw new Error(`清除 tokens/cwa.js 失敗：${err.message}`);
  }
}

/**
 * 若 tokens 目錄為空則嘗試刪除（僅清理，失敗時不影響測試）
 */
function safeCleanupTokensDir() {
  try {
    if (fs.existsSync(TOKENS_DIR) && fs.readdirSync(TOKENS_DIR).length === 0) {
      fs.rmdirSync(TOKENS_DIR);
    }
  } catch (err) {
    // 測試結束後的清理若失敗僅記錄於主控台即可
    console.warn(`清理 tokens 目錄時出現非致命錯誤：${err.message}`);
  }
}

/**
 * 建立 https.get 的模擬實作
 * @param {Array<Object>} responses 預先排定的回應序列
 * @returns {jest.Mock}
 */
function createHttpsGetMock(responses = []) {
  const queue = responses.map((config) => ({ ...config }));
  return jest.fn((url, handler) => {
    const responseConfig = queue.length ? queue.shift() : {};
    const request = new EventEmitter();
    request.setTimeout = jest.fn((timeout, onTimeout) => {
      request._timeoutHandler = onTimeout;
      request._timeoutValue = timeout;
    });
    request.destroy = jest.fn((error) => {
      if (typeof request._errorHandler === 'function') {
        request._errorHandler(error);
      }
    });
    request.on = jest.fn((event, callback) => {
      if (event === 'error') {
        request._errorHandler = callback;
      }
    });

    process.nextTick(() => {
      if (responseConfig.error) {
        if (typeof request._errorHandler === 'function') {
          request._errorHandler(responseConfig.error);
        }
        return;
      }

      const response = new EventEmitter();
      response.statusCode = responseConfig.statusCode ?? 200;
      handler(response);

      const body = responseConfig.body !== undefined
        ? responseConfig.body
        : JSON.stringify({ ok: true });

      if (body !== null) {
        response.emit('data', body);
      }
      response.emit('end');
    });

    return request;
  });
}

/**
 * 依照需求載入 WeatherSystem 本地策略
 * @param {Object} options
 * @param {Array<Object>} [options.responses]
 * @param {boolean} [options.hasApiKey]
 * @returns {{strategy: Object, httpsGetMock: jest.Mock}}
 */
function loadLocalStrategy({ responses = [], hasApiKey = true } = {}) {
  jest.resetModules();
  jest.clearAllMocks();

  safeRemoveTokenFile();

  if (hasApiKey) {
    safeWriteTokenFile('TEST_API_KEY');
  }

  const httpsGetMock = createHttpsGetMock(responses);
  jest.doMock('https', () => ({ get: httpsGetMock }));

  const strategy = require('../src/plugins/weatherSystem/strategies/local');
  return { strategy, httpsGetMock };
}

afterEach(() => {
  jest.unmock('https');
  jest.restoreAllMocks();
  safeRemoveTokenFile();
  safeCleanupTokensDir();
});

describe('WeatherSystem 本地策略', () => {
  test('未上線時應回傳錯誤提示', async () => {
    const { strategy, httpsGetMock } = loadLocalStrategy();

    const result = await strategy.send({ apiName: 'GetWeather36h' });

    expect(result).toEqual({ error: 'WeatherSystem 尚未上線' });
    expect(httpsGetMock).not.toHaveBeenCalled();
  });

  test('缺少金鑰時應阻擋請求', async () => {
    const { strategy, httpsGetMock } = loadLocalStrategy({ hasApiKey: false });

    await strategy.online();
    const result = await strategy.send({ apiName: 'GetWeather36h' });

    expect(result).toEqual({ error: '缺少 API 金鑰' });
    expect(httpsGetMock).not.toHaveBeenCalled();
  });

  test('應合併預設參數並成功回傳資料', async () => {
    const responses = [
      { statusCode: 200, body: JSON.stringify({ success: true }) }
    ];
    const { strategy, httpsGetMock } = loadLocalStrategy({ responses });

    await strategy.online();
    const result = await strategy.send({
      apiName: 'GetWeather36h',
      params: { locationName: '高雄市', elementName: 'T' }
    });

    expect(result).toEqual({ result: { success: true }, resultType: 'json' });
    expect(httpsGetMock).toHaveBeenCalledTimes(1);

    const calledUrl = new URL(httpsGetMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('Authorization')).toBe('TEST_API_KEY');
    expect(calledUrl.searchParams.get('format')).toBe('JSON');
    expect(calledUrl.searchParams.get('locationName')).toBe('高雄市');
    expect(calledUrl.searchParams.get('elementName')).toBe('T');
  });

  test('遇到狀態碼錯誤時應自動重試一次', async () => {
    const responses = [
      { statusCode: 500, body: JSON.stringify({ message: 'fail' }) },
      { statusCode: 200, body: JSON.stringify({ success: true }) }
    ];
    const { strategy, httpsGetMock } = loadLocalStrategy({ responses });

    await strategy.online();
    const result = await strategy.send({ apiName: 'GetWeather36h' });

    expect(result).toEqual({ result: { success: true }, resultType: 'json' });
    expect(httpsGetMock).toHaveBeenCalledTimes(2);
  });

  test('收到無效 JSON 時應回傳解析錯誤', async () => {
    const responses = [
      { statusCode: 200, body: 'not json' }
    ];
    const { strategy } = loadLocalStrategy({ responses });

    await strategy.online();
    const result = await strategy.send({ apiName: 'GetWeather36h' });

    expect(result).toEqual({ error: 'JSON 解析失敗' });
  });

  test('超過每分鐘速率限制時應阻止呼叫', async () => {
    const responses = Array.from({ length: 60 }, () => ({
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    }));
    const { strategy, httpsGetMock } = loadLocalStrategy({ responses });

    await strategy.online();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);

    for (let i = 0; i < 60; i += 1) {
      const res = await strategy.send({ apiName: 'GetWeather36h' });
      expect(res.result).toBeDefined();
    }

    const overflow = await strategy.send({ apiName: 'GetWeather36h' });
    expect(overflow).toEqual({ error: '超過每分鐘 API 呼叫上限' });
    expect(httpsGetMock).toHaveBeenCalledTimes(60);

    nowSpy.mockRestore();
  });
});

