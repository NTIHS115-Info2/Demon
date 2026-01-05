const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const GlobalErrorHandler = require('../../../../utils/globalErrorHandler');
const info = require('../server/infor');

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
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
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
   * @param {Array} messages - 傳遞給 Llama 的訊息陣列
   * @returns {EventEmitter}
   */
  async send(options = []) {
    if (!baseUrl) {
      const error = new Error('遠端未初始化');
      logger.error('嘗試使用未初始化的遠端策略');
      throw error;
    }

    const emitter = new EventEmitter();
    let stream = null;
    let retryCount = 0;

    // 狀態旗標與超時計時器，確保中止與超時可控
    let aborted = false;
    let dataTimeout = null;

    // 解析輸入參數，統一支援 messages 與 stream 設定
    const { messages, stream: streamEnabled } = normalizeSendOptions(options);

    const url = `${baseUrl}/${info.subdomain}/${info.routes.send}`;
    const payload = { messages, stream: streamEnabled };

    logger.info(`開始 API 請求: ${url}`);
    logger.info(`請求參數: ${JSON.stringify({ messageCount: messages.length, stream: streamEnabled })}`);

    const attemptRequest = async () => {
      try {
        logger.info(`API 請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);
        
        const response = await axios({
          url,
          method: 'POST',
          data: payload,
          responseType: streamEnabled ? 'stream' : 'json',
          headers: { 'Content-Type': 'application/json' },
          timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
          // 添加更詳細的超時配置
          httpsAgent: false,
          httpAgent: false,
          // 連接超時配置
          timeoutErrorMessage: `API 請求超時 (${ERROR_CONFIG.REQUEST_TIMEOUT}ms)`
        });

        logger.info(`API 請求成功，狀態碼: ${response.status}`);

        // 非串流回應時，以單次 data + end 模擬 Local 契約
        if (!streamEnabled) {
          handleNonStreamResponse(response, emitter);
          return;
        }

        // 確認串流物件存在，避免非預期結構導致崩潰
        if (!response.data || typeof response.data.on !== 'function') {
          const streamError = new Error('遠端回應未提供可用的串流資料');
          logger.error(streamError.message);
          emitter.emit('error', streamError);
          return;
        }

        stream = response.data;
        let buffer = '';
        let dataReceived = false;
        let streamCompleted = false;

        // 設置資料接收超時，避免長時間無資料卡住
        dataTimeout = setTimeout(() => {
          if (!dataReceived && !aborted) {
            const timeoutError = new Error('API 資料接收超時');
            logger.error('長時間未收到 API 資料，可能發生超時');
            emitter.emit('error', timeoutError);
          }
        }, ERROR_CONFIG.CONNECTION_TIMEOUT);

        stream.on('data', chunk => {
          // 若已中止則直接忽略後續資料
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
              if (!line.startsWith('data: ')) {
                continue;
              }

              const content = line.replace('data: ', '').trim();
              if (content === '[DONE]') {
                streamCompleted = true;
                logger.info('API 串流完成');
                emitter.emit('end');
                return;
              }

              try {
                const json = JSON.parse(content);
                if (!isExpectedPayload(json)) {
                  const payloadError = new Error('串流資料結構非預期');
                  logger.error(`${payloadError.message}，內容: ${content}`);
                  emitter.emit('error', payloadError);
                  continue;
                }

                const text = extractTextFromPayload(json);
                emitter.emit('data', text, json);
              } catch (parseError) {
                logger.error(`JSON 解析失敗: ${parseError.message}, 內容: ${content}`);
                emitter.emit('error', parseError);
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

          // 若未收到完成訊號就結束，視為串流中斷
          if (!streamCompleted && !aborted) {
            const endError = new Error('串流意外結束，未收到完成訊號');
            logger.error(endError.message);
            emitter.emit('error', endError);
          }

          // 檢查是否遺留未解析資料，避免吞掉內容
          if (buffer.trim()) {
            const bufferError = new Error('串流結束時仍有未解析資料');
            logger.error(bufferError.message);
            emitter.emit('error', bufferError);
          }

          logger.info('API 串流自然結束');
          emitter.emit('end');
        });

        stream.on('error', (streamError) => {
          clearTimeout(dataTimeout);
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
          // 記錄最終失敗
          GlobalErrorHandler.logError(error, {
            module: 'LlamaRemote',
            method: 'send',
            url: url,
            retryCount: retryCount,
            messageCount: messages.length
          });
          
          emitter.emit('error', error);
        }
      }
    };

    // 開始請求
    attemptRequest();

    emitter.abort = () => {
      logger.info('收到中止請求');
      // 主動標記中止，避免後續事件影響
      aborted = true;
      clearTimeout(dataTimeout);
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

// 將輸入參數整理成統一格式，支援陣列或物件形式
function normalizeSendOptions(options) {
  if (Array.isArray(options)) {
    return { messages: options, stream: true };
  }

  if (!options || typeof options !== 'object') {
    return { messages: [], stream: true };
  }

  return {
    messages: Array.isArray(options.messages) ? options.messages : [],
    stream: options.stream !== false
  };
}

// 判斷回傳的 JSON 是否符合預期結構，避免非預期資料直接流出
function isExpectedPayload(json) {
  if (!json || typeof json !== 'object') {
    return false;
  }

  if (Array.isArray(json.choices)) {
    return true;
  }

  if (typeof json.content === 'string') {
    return true;
  }

  if (typeof json.text === 'string') {
    return true;
  }

  return false;
}

// 統一抽取 text 欄位，維持與 Local 相同的欄位優先順序
function extractTextFromPayload(json) {
  if (!json || typeof json !== 'object') {
    return '';
  }

  const fallbackContent = typeof json.content === 'string'
    ? json.content
    : json.choices?.[0]?.message?.content;

  return json.choices?.[0]?.delta?.content || json.text || fallbackContent || '';
}

// 處理非串流模式回應，模擬一次性 data + end 行為
function handleNonStreamResponse(response, emitter) {
  try {
    const json = response?.data;

    if (!isExpectedPayload(json)) {
      const payloadError = new Error('非串流回應資料結構非預期');
      emitter.emit('error', payloadError);
    }

    const text = extractTextFromPayload(json);
    emitter.emit('data', text, json);
    emitter.emit('end');
  } catch (error) {
    emitter.emit('error', error);
  }
}
