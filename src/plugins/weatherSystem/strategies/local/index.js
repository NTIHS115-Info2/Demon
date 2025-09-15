const https = require('https');
const { URL, URLSearchParams } = require('url');
const Logger = require('../../../../utils/logger');

// 建立記錄器
const logger = new Logger('weatherSystem-local');

// 讀取根目錄 tokens/cwa.js 內的 API 金鑰
let apiKey = null;
try {
  ({ CWA_API_KEY: apiKey } = require('../../../../../tokens/cwa'));
} catch (e) {
  logger.warn('無法載入 tokens/cwa.js，請確認 API 金鑰設定');
}

// 預設啟動優先度
const priority = 10;
let onlineState = false;

// 每分鐘最多允許呼叫次數
const MAX_CALLS_PER_MIN = 60;
// 紀錄最近一分鐘內的呼叫時間戳記
const callHistory = [];

// 氣象局資料集對應表
const API_MAP = {
  GetWeather36h: 'F-C0032-001',
  GetWeatherWeekly: 'F-C0032-005',
  GetTownWeather: 'F-D0047-093',
  GetStationWeatherNow: 'O-A0003-001',
  GetRainfallNow: 'O-A0002-001',
  GetUVIndex: 'O-A0005-001',
  GetEarthquakeReport: 'E-Q0015-001',
  GetHeavyRainAlert: 'W-C0033-004',
  GetColdAlert: 'W-C0033-003',
  GetTyphoonAlert: 'W-TYP-002'
};

// 各 API 可自訂參數的預設值，未指定時皆以臺南市為主
const DEFAULT_PARAMS = {
  GetWeather36h: { locationName: '臺南市' },
  GetWeatherWeekly: { locationName: '臺南市' },
  GetTownWeather: { locationName: '臺南市', townName: '中西區' },
  GetStationWeatherNow: { stationId: '467410' },
  GetRainfallNow: { stationId: '467410' },
  GetUVIndex: { locationName: '臺南市' },
  GetEarthquakeReport: {},
  GetHeavyRainAlert: { locationName: '臺南市' },
  GetColdAlert: { locationName: '臺南市' },
  GetTyphoonAlert: { locationName: '臺南市' }
};

/**
 * 依據 API 名稱組合完整 URL
 * @param {string} apiName - API 名稱
 * @param {Object} params - 查詢參數
 * @param {string} apiKey - 授權金鑰
 * @returns {string}
 */
function buildUrl(apiName, params = {}, apiKey) {
  const datasetId = API_MAP[apiName];
  if (!datasetId) throw new Error('未知的 API 名稱');
  if (!apiKey) throw new Error('缺少 API 金鑰');

  const base = new URL(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/${datasetId}`);
  const search = new URLSearchParams({ Authorization: apiKey, format: 'JSON', ...params });
  base.search = search.toString();
  return base.toString();
}

/**
 * 發送 HTTP GET 請求並解析 JSON，若失敗則重試一次
 * @param {string} url - 目標網址
 * @param {number} retries - 剩餘重試次數
 * @returns {Promise<Object>}
 */
function requestWithRetry(url, retries = 1) {
  return new Promise((resolve, reject) => {
    const attempt = (remain) => {
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('JSON 解析失敗'));
            }
          } else if (remain > 0) {
            logger.warn(`API 回傳狀態碼 ${res.statusCode}，剩餘重試次數 ${remain}`);
            attempt(remain - 1);
          } else {
            reject(new Error(`API 請求失敗，狀態碼 ${res.statusCode}`));
          }
        });
      });
      req.on('error', (err) => {
        if (remain > 0) {
          logger.warn('API 請求錯誤，重試中... ' + err.message);
          attempt(remain - 1);
        } else {
          reject(err);
        }
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error('API 請求逾時'));
      });
    };
    attempt(retries);
  });
}

/**
 * 檢查是否超過每分鐘 API 呼叫上限
 * @returns {boolean}
 */
function checkRateLimit() {
  const now = Date.now();
  // 移除一分鐘前的紀錄
  while (callHistory.length && now - callHistory[0] > 60000) {
    callHistory.shift();
  }
  if (callHistory.length >= MAX_CALLS_PER_MIN) {
    return false;
  }
  callHistory.push(now);
  return true;
}

module.exports = {
  priority,
  /**
   * 啟動本地天氣服務
   * @returns {Promise<void>}
   */
  async online() {
    onlineState = true;
    logger.info('本地 WeatherSystem 已上線');
  },

  /**
   * 關閉本地天氣服務
   * @returns {Promise<void>}
   */
  async offline() {
    onlineState = false;
    logger.info('本地 WeatherSystem 已離線');
  },

  /**
   * 重啟本地天氣服務
   * @returns {Promise<void>}
   */
  async restart() {
    await this.offline();
    await this.online();
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<number>} 1: 上線, 0: 離線
   */
  async state() {
    return onlineState ? 1 : 0;
  },

  /**
   * 呼叫指定氣象 API 並回傳結果
   * @param {Object} data - 呼叫參數
   * @param {string} data.apiName - API 名稱
   * @param {Object} [data.params] - 查詢參數
   * @returns {Promise<Object>} 回傳資料或錯誤訊息
   */
  async send(data = {}) {
    if (!onlineState) {
      return { error: 'WeatherSystem 尚未上線' };
    }
    try {
      if (!checkRateLimit()) {
        return { error: '超過每分鐘 API 呼叫上限' };
      }
      if (!apiKey) {
        return { error: '缺少 API 金鑰' };
      }
      // 合併預設參數與外部傳入參數，未指定時採用預設的臺南市設定
      const mergedParams = { ...DEFAULT_PARAMS[data.apiName], ...(data.params || {}) };
      const url = buildUrl(data.apiName, mergedParams, apiKey);
      const result = await requestWithRetry(url, 1);
      return { result, resultType: 'json' };
    } catch (e) {
      logger.error('WeatherSystem API 呼叫失敗: ' + e.message);
      return { error: e.message };
    }
  }
};
