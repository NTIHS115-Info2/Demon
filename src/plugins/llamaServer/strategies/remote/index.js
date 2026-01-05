const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const GlobalErrorHandler = require('../../../../utils/globalErrorHandler');
const info = require('../server/infor');

const logger = new Logger('LlamaRemote');

let baseUrl = '';

// 遠端請求可識別錯誤類型的常數集合
const ERROR_TYPES = Object.freeze({
  REQUEST: 'request_error',
  SERVER: 'server_error',
  TIMEOUT: 'timeout',
  PARSE: 'parse_error'
});

// 此策略的預設啟動優先度
const priority = 40;

// 錯誤處理配置
const ERROR_CONFIG = Object.freeze({
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000,  // 基礎延遲 1 秒
  REQUEST_TIMEOUT: 30000,  // 30 秒超時
  CONNECTION_TIMEOUT: 10000 // 10 秒連接超時
});

// 遠端請求預設設定，允許在線上啟動或請求時覆寫
const runtimeConfig = {
  timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
  req_id: null,
  req_id_header: 'X-Request-Id'
};

module.exports = {
    priority,
  /**
   * 啟動遠端策略
   * @param {Object} options
   * @param {string} options.baseUrl 遠端伺服器位址，例如 https://xxxx.ngrok.io
   */
  async online(options = {}) {
    if (!options.baseUrl) {
      throw new Error('遠端模式需要提供 baseUrl');
    }

    // 解析並記錄遠端請求的預設設定，供後續 send 使用
    const resolvedConfig = resolveRuntimeConfig(options, runtimeConfig);
    runtimeConfig.timeout = resolvedConfig.timeout;
    runtimeConfig.req_id = resolvedConfig.req_id;
    runtimeConfig.req_id_header = resolvedConfig.req_id_header;
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
    logger.info(`Llama remote 使用預設 timeout: ${runtimeConfig.timeout}ms`);
    if (runtimeConfig.req_id) {
      logger.info(`Llama remote 預設 req_id: ${runtimeConfig.req_id}`);
    }
    return true;
  },

  /** 停止遠端策略 */
  async offline() {
    baseUrl = '';
    logger.info('Llama remote 已關閉');
    return true;
  },

  /** 重新啟動遠端策略 */
  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  /** 檢查狀態：有 baseUrl 即視為上線 */
  async state() {
    return baseUrl ? 1 : 0;
  },

  /**
   * 透過 HTTP 與遠端伺服器互動
   * @param {Array|Object} payload - 傳遞給 Llama 的訊息陣列或設定物件
   * @returns {EventEmitter}
   */
  async send(payload = []) {
    if (!baseUrl) {
      const error = new Error('遠端未初始化');
      logger.error('嘗試使用未初始化的遠端策略');
      throw error;
    }

    const emitter = new EventEmitter();
    let stream = null;
    let retryCount = 0;

    // 正規化輸入資料與請求設定，確保兼容舊有 messages 形式
    const normalizedInput = normalizeSendPayload(payload);
    const messages = normalizedInput.messages;

    // 解析每次請求可覆寫的 timeout 與 req_id 設定
    const requestConfig = resolveRuntimeConfig(normalizedInput.options, runtimeConfig);
    const requestId = requestConfig.req_id;

    const url = `${baseUrl}/${info.subdomain}/${info.routes.send}`;
    const requestBody = { messages, stream: true };

    logger.info(`開始 API 請求: ${url}`);
    logger.info(`請求參數: ${JSON.stringify({ messageCount: messages.length, stream: true })}`);
    if (requestId) {
      logger.info(`本次請求使用 req_id: ${requestId}`);
    }

    const attemptRequest = async () => {
      try {
        logger.info(`API 請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);

        // 組合請求標頭，必要時加入 req_id 追蹤資訊
        const headers = {
          'Content-Type': 'application/json',
          ...(requestId ? { [requestConfig.req_id_header]: requestId } : {})
        };
        
        const response = await axios({
          url,
          method: 'POST',
          data: requestBody,
          responseType: 'stream',
          headers,
          timeout: requestConfig.timeout,
          // 添加更詳細的超時配置
          httpsAgent: false,
          httpAgent: false,
          // 連接超時配置
          timeoutErrorMessage: `API 請求超時 (${requestConfig.timeout}ms)`
        });

        logger.info(`API 請求成功，狀態碼: ${response.status}`);
        
        stream = response.data;
        let buffer = '';
        let dataReceived = false;

        // 設置資料接收超時
        const dataTimeout = setTimeout(() => {
          if (!dataReceived) {
            // 當長時間未收到資料時，回傳一致格式的 timeout 錯誤
            const timeoutError = createTypedError({
              type: ERROR_TYPES.TIMEOUT,
              message: 'API 資料接收超時',
              reqId: requestId,
              phase: 'stream-timeout',
              url
            });
            logger.error('長時間未收到 API 資料，可能發生超時');
            emitter.emit('error', timeoutError);
          }
        }, ERROR_CONFIG.CONNECTION_TIMEOUT);

        stream.on('data', chunk => {
          dataReceived = true;
          clearTimeout(dataTimeout);
          
          try {
            buffer += chunk.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop();
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const content = line.replace('data: ', '').trim();
                if (content === '[DONE]') {
                  logger.info('API 串流完成');
                  emitter.emit('end');
                  return;
                }
                try {
                  const json = JSON.parse(content);
                  const text = json.text || json.choices?.[0]?.delta?.content || '';
                  emitter.emit('data', text, json);
                } catch (parseError) {
                  // 當 JSON 解析失敗時，回傳一致格式的 parse error 錯誤
                  const parseErrorPayload = createTypedError({
                    type: ERROR_TYPES.PARSE,
                    message: `JSON 解析失敗: ${parseError.message}`,
                    reqId: requestId,
                    phase: 'stream-parse',
                    url,
                    details: { content }
                  });
                  logger.warn(`JSON 解析失敗: ${parseError.message}, 內容: ${content}`);
                  emitter.emit('error', parseErrorPayload);
                }
              } else if (line.trim()) {
                // 當 SSE 行資料格式不符合預期時，回傳 parse error 供下游辨識
                const isKnownSseField = line.startsWith('event:')
                  || line.startsWith('id:')
                  || line.startsWith('retry:')
                  || line.startsWith(':');
                if (!isKnownSseField) {
                  const sseErrorPayload = createTypedError({
                    type: ERROR_TYPES.PARSE,
                    message: 'SSE 資料格式解析失敗',
                    reqId: requestId,
                    phase: 'stream-parse',
                    url,
                    details: { line }
                  });
                  logger.warn(`SSE 解析失敗，未知格式: ${line}`);
                  emitter.emit('error', sseErrorPayload);
                }
              }
            }
          } catch (error) {
            // 串流處理異常時，封裝為統一錯誤格式回傳
            const dataError = createTypedError({
              type: ERROR_TYPES.SERVER,
              message: `處理串流資料時發生錯誤: ${error.message}`,
              reqId: requestId,
              phase: 'data-processing',
              url,
              originalError: error
            });
            logger.error(`處理串流資料時發生錯誤: ${error.message}`);
            GlobalErrorHandler.logError(error, { 
              module: 'LlamaRemote', 
              method: 'send',
              phase: 'data-processing',
              req_id: requestId
            });
            emitter.emit('error', dataError);
          }
        });

        stream.on('end', () => {
          clearTimeout(dataTimeout);
          logger.info('API 串流自然結束');
          emitter.emit('end');
        });

        stream.on('error', (streamError) => {
          clearTimeout(dataTimeout);
          // 串流錯誤透過分類函式轉為一致錯誤格式
          const classifiedError = classifyError(streamError, {
            reqId: requestId,
            phase: 'stream-error',
            url
          });
          logger.error(`串流錯誤: ${streamError.message}`);
          
          // 區分不同類型的串流錯誤
          if (streamError.code === 'ECONNRESET') {
            logger.warn('連接被重置，可能是網路不穩定');
          } else if (streamError.code === 'ETIMEDOUT') {
            logger.warn('串流讀取超時');
          }
          
          emitter.emit('error', classifiedError);
        });

      } catch (error) {
        logger.error(`API 請求失敗: ${error.message}`);
        
        // 分析錯誤類型並決定是否重試
        const shouldRetry = shouldRetryError(error, retryCount);
        
        if (shouldRetry) {
          retryCount++;
          const delay = ERROR_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retryCount - 1);
          logger.info(`${delay}ms 後進行重試...`);
          
          setTimeout(() => {
            attemptRequest();
          }, delay);
        } else {
          // 將最終錯誤統一包裝為可辨識格式
          const classifiedError = classifyError(error, {
            reqId: requestId,
            phase: 'request',
            url
          });
          // 記錄最終失敗
          GlobalErrorHandler.logError(error, {
            module: 'LlamaRemote',
            method: 'send',
            url: url,
            retryCount: retryCount,
            messageCount: messages.length,
            req_id: requestId
          });
          
          emitter.emit('error', classifiedError);
        }
      }
    };

    // 開始請求
    attemptRequest();

    emitter.abort = () => {
      logger.info('收到中止請求');
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
        logger.info('已中止 API 串流');
        emitter.emit('abort');
      }
    };

    return emitter;
  }
};

/**
 * 正規化 send 輸入，支援 messages 陣列與帶有設定的物件
 * @param {Array|Object} payload - 送出資料或包含 messages 的設定物件
 * @returns {{messages: Array, options: Object}}
 */
function normalizeSendPayload(payload) {
  // 將輸入資料轉成固定格式，避免下游判斷錯誤
  try {
    if (Array.isArray(payload)) {
      return { messages: payload, options: {} };
    }

    if (payload && typeof payload === 'object') {
      const { messages = [], options = {} } = payload;
      const mergedOptions = { ...payload, ...options };
      delete mergedOptions.messages;
      delete mergedOptions.options;
      return { messages, options: mergedOptions };
    }

    logger.warn('send 輸入格式不正確，已回退為空資料');
    return { messages: [], options: {} };
  } catch (error) {
    logger.warn(`正規化 send 輸入失敗: ${error.message}`);
    return { messages: [], options: {} };
  }
}

/**
 * 解析 timeout 與 req_id 來源，支援 options / config / env
 * @param {Object} options - 請求或啟動時的設定
 * @param {Object} baseConfig - 既有預設設定
 * @returns {{timeout: number, req_id: (string|null), req_id_header: string}}
 */
function resolveRuntimeConfig(options = {}, baseConfig = {}) {
  // 透過 try/catch 提供安全回退，避免解析失敗導致流程中斷
  try {
    const config = options.config || {};

    // 解析 timeout，優先使用 options，再往 config 與 env 取值
    const timeout = normalizeTimeout(
      options.timeout
        ?? config.timeout
        ?? config.remote?.timeout
        ?? process.env.LLAMA_REMOTE_TIMEOUT
        ?? baseConfig.timeout
        ?? ERROR_CONFIG.REQUEST_TIMEOUT,
      ERROR_CONFIG.REQUEST_TIMEOUT
    );

    // 解析 req_id，支援 options、config 與 env
    const reqId = options.req_id
      ?? config.req_id
      ?? config.remote?.req_id
      ?? process.env.LLAMA_REMOTE_REQ_ID
      ?? baseConfig.req_id
      ?? null;

    // 解析 req_id header 名稱，確保請求可追蹤
    const reqIdHeader = options.req_id_header
      ?? config.req_id_header
      ?? config.remote?.req_id_header
      ?? process.env.LLAMA_REMOTE_REQ_ID_HEADER
      ?? baseConfig.req_id_header
      ?? 'X-Request-Id';

    return {
      timeout,
      req_id: reqId,
      req_id_header: reqIdHeader
    };
  } catch (error) {
    logger.warn(`解析遠端設定失敗，改用預設值: ${error.message}`);
    return {
      timeout: baseConfig.timeout || ERROR_CONFIG.REQUEST_TIMEOUT,
      req_id: baseConfig.req_id || null,
      req_id_header: baseConfig.req_id_header || 'X-Request-Id'
    };
  }
}

/**
 * 將 timeout 轉為有效數值，無效時回退預設值
 * @param {number|string} value - 輸入 timeout 值
 * @param {number} fallback - 預設值
 * @returns {number}
 */
function normalizeTimeout(value, fallback) {
  // 確保 timeout 為正整數，避免 axios 產生不預期錯誤
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * 建立一致格式的錯誤物件，確保下游可辨識
 * @param {Object} payload - 錯誤欄位組合
 * @returns {Error}
 */
function createTypedError(payload = {}) {
  // 使用 try/catch 確保錯誤物件建立失敗時仍有 fallback
  try {
    const error = new Error(payload.message || '未知錯誤');
    error.type = payload.type || ERROR_TYPES.SERVER;
    error.status = payload.status;
    error.code = payload.code;
    error.req_id = payload.reqId;
    error.phase = payload.phase;
    error.url = payload.url;
    error.details = payload.details;
    if (payload.originalError) {
      error.originalError = payload.originalError;
    }
    return error;
  } catch (error) {
    const fallbackError = new Error(payload.message || '未知錯誤');
    fallbackError.type = payload.type || ERROR_TYPES.SERVER;
    fallbackError.req_id = payload.reqId;
    return fallbackError;
  }
}

/**
 * 將錯誤分類為 4xx、5xx、timeout 或 parse error
 * @param {Error} error - 原始錯誤
 * @param {Object} context - 補充資訊
 * @returns {Error}
 */
function classifyError(error, context = {}) {
  // 透過 try/catch 確保分類失敗時仍可回傳一致錯誤
  try {
    if (error?.type && error?.req_id !== undefined) {
      return error;
    }

    const status = error?.response?.status;
    const isTimeout = error?.code === 'ECONNABORTED'
      || error?.code === 'ETIMEDOUT'
      || (typeof error?.message === 'string' && error.message.toLowerCase().includes('timeout'));

    let type = ERROR_TYPES.SERVER;
    if (status >= 500) {
      type = ERROR_TYPES.SERVER;
    } else if (status >= 400) {
      type = ERROR_TYPES.REQUEST;
    } else if (isTimeout) {
      type = ERROR_TYPES.TIMEOUT;
    }

    return createTypedError({
      type,
      message: error?.message || '未知錯誤',
      status,
      code: error?.code,
      reqId: context.reqId,
      phase: context.phase,
      url: context.url,
      originalError: error
    });
  } catch (classificationError) {
    return createTypedError({
      type: ERROR_TYPES.SERVER,
      message: '錯誤分類失敗',
      reqId: context.reqId,
      phase: context.phase,
      url: context.url,
      originalError: classificationError
    });
  }
}

/**
 * 判斷錯誤是否應該重試
 * @param {Error} error - 錯誤對象
 * @param {number} currentRetryCount - 當前重試次數
 * @returns {boolean} - 是否應該重試
 */
function shouldRetryError(error, currentRetryCount) {
  // 已達最大重試次數
  if (currentRetryCount >= ERROR_CONFIG.MAX_RETRIES) {
    logger.info(`已達最大重試次數 (${ERROR_CONFIG.MAX_RETRIES})，不再重試`);
    return false;
  }

  // 根據錯誤類型決定是否重試
  const retryableErrors = [
    'ECONNABORTED',  // 請求超時
    'ENOTFOUND',     // DNS 解析失敗
    'ECONNREFUSED',  // 連接被拒絕
    'ECONNRESET',    // 連接被重置
    'ETIMEDOUT',     // 超時
    'ENETUNREACH',   // 網路不可達
    'EAI_AGAIN'      // DNS 暫時失敗
  ];

  const isRetryable = retryableErrors.includes(error.code) || 
                     (error.response && error.response.status >= 500) || // 伺服器錯誤
                     error.message.includes('timeout');

  if (isRetryable) {
    logger.info(`錯誤類型 ${error.code || 'unknown'} 可以重試`);
  } else {
    logger.info(`錯誤類型 ${error.code || 'unknown'} 不適合重試`);
  }

  return isRetryable;
}
