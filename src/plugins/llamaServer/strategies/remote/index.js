const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const GlobalErrorHandler = require('../../../../utils/globalErrorHandler');

const logger = new Logger('LlamaRemote');

let baseUrl = '';

// 此策略的預設啟動優先度
const priority = 40;

// 錯誤處理配置
const ERROR_CONFIG = Object.freeze({
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000,  // 基礎延遲 1 秒
  REQUEST_TIMEOUT: 30000,  // 30 秒超時
  CONNECTION_TIMEOUT: 10000 // 10 秒連接超時
});

// OpenAI 相容 API 路徑設定
const OPENAI_PATHS = Object.freeze({
  MODELS: '/v1/models',
  CHAT_COMPLETIONS: '/v1/chat/completions'
});

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
    // 設定遠端 baseUrl 並移除尾端斜線
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
    // 透過 /v1/models 進行健康檢查，確保遠端服務可用
    const healthResult = await checkModelsHealth();
    if (!healthResult.ok) {
      logger.error(`遠端健康檢查失敗：${healthResult.message}`);
      throw healthResult.error;
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
    // 尚未設定 baseUrl 時直接視為下線
    if (!baseUrl) {
      return 0;
    }
    // 使用 /v1/models 健康檢查判斷是否可用
    const healthResult = await checkModelsHealth();
    if (!healthResult.ok) {
      logger.warn(`遠端狀態檢查失敗：${healthResult.message}`);
      return -1;
    }
    return 1;
  },

  /**
   * 透過 HTTP 與遠端伺服器互動
   * @param {Array} messages - 傳遞給 Llama 的訊息陣列
   * @returns {EventEmitter}
   */
  async send(options = []) {
    // 檢查 baseUrl 是否存在
    if (!baseUrl) {
      const error = new Error('遠端未初始化');
      logger.error('嘗試使用未初始化的遠端策略');
      throw error;
    }

    // 建立事件發射器以保持與 local 策略一致
    const emitter = new EventEmitter();
    let stream = null;
    let aborted = false;
    let retryCount = 0;
    // 建立 AbortController 以支援中斷請求
    const controller = new AbortController();

    // 正規化輸入參數與必要欄位
    const normalizedOptions = normalizeSendOptions(options);
    // 組合 OpenAI 相容 API 的完整 URL
    const url = buildOpenAiUrl(OPENAI_PATHS.CHAT_COMPLETIONS);
    // 組裝送出 payload，包含 model、messages 與 stream 旗標
    const payload = buildChatPayload(normalizedOptions);

    logger.info(`開始 API 請求: ${url}`);
    logger.info(`請求參數: ${JSON.stringify({ messageCount: normalizedOptions.messages.length, stream: normalizedOptions.stream })}`);

    // 處理串流回應的請求流程
    const attemptStreamRequest = async () => {
      // 若已中止則不再發送請求
      if (aborted) {
        return;
      }
      try {
        logger.info(`API 串流請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);
        
        const response = await axios({
          url,
          method: 'POST',
          data: payload,
          responseType: 'stream',
          headers: { 'Content-Type': 'application/json' },
          timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
          signal: controller.signal,
          // 添加更詳細的超時配置
          httpsAgent: false,
          httpAgent: false,
          // 連接超時配置
          timeoutErrorMessage: `API 請求超時 (${ERROR_CONFIG.REQUEST_TIMEOUT}ms)`
        });

        logger.info(`API 串流請求成功，狀態碼: ${response.status}`);
        
        stream = response.data;
        let buffer = '';
        let dataReceived = false;

        // 設置資料接收超時
        const dataTimeout = setTimeout(() => {
          if (!dataReceived) {
            const timeoutError = new Error('API 資料接收超時');
            logger.error('長時間未收到 API 資料，可能發生超時');
            emitter.emit('error', timeoutError);
          }
        }, ERROR_CONFIG.CONNECTION_TIMEOUT);

        stream.on('data', chunk => {
          // 已中止時忽略後續資料
          if (aborted) {
            return;
          }
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
                  // 轉換為與 local 策略一致的回應結構
                  const normalized = normalizeCompletionChunk(json);
                  const text = normalized.choices?.[0]?.delta?.content || normalized.content || '';
                  emitter.emit('data', text, normalized);
                } catch (parseError) {
                  logger.warn(`JSON 解析失敗: ${parseError.message}, 內容: ${content}`);
                  // 通知呼叫端解析錯誤，但不中斷整個串流流程
                  emitter.emit('error', parseError);
                }
              }
            }
          } catch (error) {
            logger.error(`處理串流資料時發生錯誤: ${error.message}`);
            GlobalErrorHandler.logError(error, { 
              module: 'LlamaRemote', 
              method: 'send',
              phase: 'data-processing'
            });
            emitter.emit('error', error);
          }
        });

        stream.on('end', () => {
          clearTimeout(dataTimeout);
          // 已中止時避免重複結束事件
          if (aborted) {
            return;
          }
          logger.info('API 串流自然結束');
          emitter.emit('end');
        });

        stream.on('error', (streamError) => {
          clearTimeout(dataTimeout);
          // 已中止時避免重複錯誤事件
          if (aborted) {
            return;
          }
          logger.error(`串流錯誤: ${streamError.message}`);
          
          // 區分不同類型的串流錯誤
          if (streamError.code === 'ECONNRESET') {
            logger.warn('連接被重置，可能是網路不穩定');
          } else if (streamError.code === 'ETIMEDOUT') {
            logger.warn('串流讀取超時');
          }
          
          emitter.emit('error', streamError);
        });

      } catch (error) {
        // 已中止時不再處理錯誤流程
        if (aborted) {
          return;
        }
        logger.error(`API 串流請求失敗: ${error.message}`);
        
        // 分析錯誤類型並決定是否重試
        const shouldRetry = shouldRetryError(error, retryCount);
        
        if (shouldRetry) {
          retryCount++;
          const delay = ERROR_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retryCount - 1);
          logger.info(`${delay}ms 後進行重試...`);
          
          setTimeout(() => {
            attemptStreamRequest();
          }, delay);
        } else {
          // 記錄最終失敗
          GlobalErrorHandler.logError(error, {
            module: 'LlamaRemote',
            method: 'send',
            url: url,
            retryCount: retryCount,
            messageCount: normalizedOptions.messages.length
          });
          
          emitter.emit('error', error);
        }
      }
    };

    // 處理非串流回應的請求流程
    const attemptNonStreamRequest = async () => {
      // 若已中止則不再發送請求
      if (aborted) {
        return;
      }
      try {
        logger.info(`API 非串流請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);

        const response = await axios({
          url,
          method: 'POST',
          data: payload,
          responseType: 'text',
          headers: { 'Content-Type': 'application/json' },
          timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
          signal: controller.signal,
          timeoutErrorMessage: `API 請求超時 (${ERROR_CONFIG.REQUEST_TIMEOUT}ms)`,
          validateStatus: () => true
        });

        // 處理非 2xx 回應狀態
        if (response.status >= 400) {
          const statusType = response.status >= 500 ? '5xx' : '4xx';
          const error = new Error(`API 非串流請求失敗，狀態碼: ${response.status}`);
          error.status = response.status;
          error.type = statusType;
          error.response = { status: response.status };
          throw error;
        }

        // 解析非串流回應內容並正規化
        let parsed;
        try {
          parsed = response.data ? JSON.parse(response.data) : {};
        } catch (parseError) {
          const error = new Error(`API 非串流回應解析失敗: ${parseError.message}`);
          error.type = 'parse_error';
          throw error;
        }

        const normalized = normalizeCompletionChunk(parsed);
        const text = normalized.choices?.[0]?.delta?.content || normalized.content || '';
        if (!aborted) {
          emitter.emit('data', text, normalized);
          emitter.emit('end');
        }
      } catch (error) {
        // 已中止時不再處理錯誤流程
        if (aborted) {
          return;
        }
        logger.error(`API 非串流請求失敗: ${error.message}`);

        // 分析錯誤類型並決定是否重試
        const shouldRetry = shouldRetryError(error, retryCount);

        if (shouldRetry) {
          retryCount++;
          const delay = ERROR_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retryCount - 1);
          logger.info(`${delay}ms 後進行重試...`);

          setTimeout(() => {
            attemptNonStreamRequest();
          }, delay);
        } else {
          GlobalErrorHandler.logError(error, {
            module: 'LlamaRemote',
            method: 'send',
            url: url,
            retryCount: retryCount,
            messageCount: normalizedOptions.messages.length
          });

          emitter.emit('error', error);
        }
      }
    };

    // 根據 stream 旗標決定串流或非串流流程
    if (normalizedOptions.stream) {
      attemptStreamRequest();
    } else {
      attemptNonStreamRequest();
    }

    emitter.abort = () => {
      // 標記為中止並停止後續處理
      aborted = true;
      logger.info('收到中止請求');
      controller.abort();
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
 * 組合 OpenAI 相容 API 的完整 URL
 * @param {string} path
 * @returns {string}
 */
function buildOpenAiUrl(path) {
  // 確保 baseUrl 與路徑正確拼接
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * 正規化送出參數，確保包含 model 與 messages
 * @param {Array|Object} options
 * @returns {{messages:Array, model:string, stream:boolean, params:Object}}
 */
function normalizeSendOptions(options) {
  // 預設值設定，避免輸入異常造成錯誤
  const defaultOptions = {
    messages: [],
    model: 'Demon',
    stream: true,
    params: {}
  };

  if (Array.isArray(options)) {
    return { ...defaultOptions, messages: options };
  }

  if (!options || typeof options !== 'object') {
    return defaultOptions;
  }

  const {
    messages = [],
    model = 'Demon',
    stream = true,
    ...rest
  } = options;

  return {
    messages: Array.isArray(messages) ? messages : [],
    model,
    stream: Boolean(stream),
    params: rest
  };
}

/**
 * 組裝 chat/completions 的 payload
 * @param {{messages:Array, model:string, stream:boolean, params:Object}} options
 * @returns {Object}
 */
function buildChatPayload(options) {
  // 組合必要欄位與額外參數
  const payload = {
    model: options.model,
    messages: options.messages,
    ...options.params
  };

  // 明確指定 stream 旗標以符合需求
  payload.stream = options.stream;

  return payload;
}

/**
 * 從回應中提取內容文字
 * @param {Object} raw
 * @returns {string}
 */
function extractCompletionContent(raw) {
  return raw?.choices?.[0]?.delta?.content
    || raw?.choices?.[0]?.message?.content
    || raw?.content
    || raw?.text
    || '';
}

/**
 * 正規化回應為 local 策略一致的結構
 * @param {Object} raw
 * @returns {Object}
 */
function normalizeCompletionChunk(raw = {}) {
  // 保留原始資料，並補齊 local 需要的欄位結構
  const normalized = { ...raw };
  const content = extractCompletionContent(raw);
  const rawChoice = Array.isArray(raw?.choices) ? raw.choices[0] : undefined;

  if (!Array.isArray(normalized.choices) || normalized.choices.length === 0) {
    normalized.choices = [{ delta: { content }, finish_reason: rawChoice?.finish_reason || null }];
  } else {
    const choice = normalized.choices[0] || {};
    choice.delta = choice.delta || {};
    if (!choice.delta.content && content) {
      choice.delta.content = content;
    }
    if (!choice.finish_reason && rawChoice?.finish_reason) {
      choice.finish_reason = rawChoice.finish_reason;
    }
    normalized.choices[0] = choice;
  }

  if (!normalized.content && content) {
    normalized.content = content;
  }

  return normalized;
}

/**
 * 使用 /v1/models 進行遠端健康檢查
 * @returns {Promise<{ok:boolean, message:string, error:Error}>}
 */
async function checkModelsHealth() {
  // 組合 /v1/models 的完整 URL
  const url = buildOpenAiUrl(OPENAI_PATHS.MODELS);

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'text',
      timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
      timeoutErrorMessage: `API 請求超時 (${ERROR_CONFIG.REQUEST_TIMEOUT}ms)`,
      validateStatus: () => true
    });

    // 檢查 4xx/5xx 狀態碼並回傳錯誤
    if (response.status >= 400) {
      const error = new Error(`模型列表查詢失敗，狀態碼: ${response.status}`);
      error.status = response.status;
      error.type = response.status >= 500 ? '5xx' : '4xx';
      return { ok: false, message: `狀態碼 ${error.status} (${error.type})`, error };
    }

    // 解析回應內容，區分解析錯誤
    try {
      JSON.parse(response.data || '{}');
    } catch (parseError) {
      const error = new Error(`模型列表回應解析失敗: ${parseError.message}`);
      error.type = 'parse_error';
      return { ok: false, message: '回應解析錯誤 (parse error)', error };
    }

    return { ok: true, message: '遠端服務正常', error: null };
  } catch (error) {
    // 區分 timeout 與其他錯誤類型
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
    const message = isTimeout ? '請求超時 (timeout)' : '連線失敗';
    error.type = isTimeout ? 'timeout' : 'network';
    return { ok: false, message, error };
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
