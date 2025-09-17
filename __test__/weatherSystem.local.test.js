const { EventEmitter } = require('events');

// 模擬 logger，避免測試時輸出大量日誌
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

const TOKEN_MODULE_PATH = '../tokens/cwa';

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

  const httpsGetMock = createHttpsGetMock(responses);
  jest.doMock('https', () => ({ get: httpsGetMock }));

  jest.doMock(
    TOKEN_MODULE_PATH,
    () => (hasApiKey ? { CWA_API_KEY: 'TEST_API_KEY' } : {}),
    { virtual: true }
  );

  const strategy = require('../src/plugins/weatherSystem/strategies/local');
  return { strategy, httpsGetMock };
}

afterEach(() => {
  jest.unmock('https');
  jest.restoreAllMocks();
  jest.unmock(TOKEN_MODULE_PATH);
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
      { statusCode: 200, body: 'not json' },
      { statusCode: 200, body: 'still not json' }
    ];
    const { strategy, httpsGetMock } = loadLocalStrategy({ responses });

    await strategy.online();
    const result = await strategy.send({ apiName: 'GetWeather36h' });

    expect(result).toEqual({ error: 'JSON 解析失敗' });
    expect(httpsGetMock).toHaveBeenCalledTimes(2);
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

