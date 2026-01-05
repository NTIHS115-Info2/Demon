const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const GlobalErrorHandler = require('../../../../utils/globalErrorHandler');
const info = require('../server/infor');

const logger = new Logger('LlamaRemote');

// 遠端策略的連線設定（由策略初始化時注入）
let baseUrl = '';
let remoteModel = '';
let requestTimeout = 30000;
let requestId = '';

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
    try {
      if (!options.baseUrl) {
        throw new Error('遠端模式需要提供 baseUrl');
      }
      // 初始化遠端連線參數，供 send 使用
      baseUrl = options.baseUrl.replace(/\/$/, '');
      remoteModel = options.model || '';
      requestTimeout = Number(options.timeout) || ERROR_CONFIG.REQUEST_TIMEOUT;
      requestId = options.reqId || '';
      logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
      if (remoteModel) {
        logger.info(`Llama remote 已設定 model: ${remoteModel}`);
      }
      if (requestId) {
        logger.info(`Llama remote 已設定 reqId: ${requestId}`);
      }
      return true;
    } catch (error) {
      logger.error(`啟動 Llama remote 失敗: ${error.message}`);
      throw error;
    }
  },

  /** 停止遠端策略 */
  async offline() {
    try {
      baseUrl = '';
      remoteModel = '';
      requestTimeout = ERROR_CONFIG.REQUEST_TIMEOUT;
      requestId = '';
      logger.info('Llama remote 已關閉');
      return true;
    } catch (error) {
      logger.error(`關閉 Llama remote 失敗: ${error.message}`);
      throw error;
    }
  },

  /** 重新啟動遠端策略 */
  async restart(options) {
    try {
      await this.offline();
      return this.online(options);
    } catch (error) {
      logger.error(`重新啟動 Llama remote 失敗: ${error.message}`);
      throw error;
    }
  },

  /** 檢查狀態：有 baseUrl 即視為上線 */
  async state() {
    try {
      return baseUrl ? 1 : 0;
    } catch (error) {
      logger.error(`取得 Llama remote 狀態失敗: ${error.message}`);
      return -1;
    }
  },

  /**
   * 透過 HTTP 與遠端伺服器互動
   * @param {Array} messages - 傳遞給 Llama 的訊息陣列
   * @returns {EventEmitter}
   */
  async send(messages = []) {
    if (!baseUrl) {
      const error = new Error('遠端未初始化');
      logger.error('嘗試使用未初始化的遠端策略');
      throw error;
    }

    const emitter = new EventEmitter();
    let stream = null;
    let retryCount = 0;

    // 組合 API 請求資訊，包含 model/req_id 等遠端參數
    const url = `${baseUrl}/${info.subdomain}/${info.routes.send}`;
    const payload = { messages, stream: true };
    if (remoteModel) {
      payload.model = remoteModel;
    }
    if (requestId) {
      payload.req_id = requestId;
    }
    if (requestTimeout) {
      payload.timeout = requestTimeout;
    }

    logger.info(`開始 API 請求: ${url}`);
    logger.info(`請求參數: ${JSON.stringify({ messageCount: messages.length, stream: true })}`);

    const attemptRequest = async () => {
      try {
        logger.info(`API 請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);
        
        const response = await axios({
          url,
          method: 'POST',
          data: payload,
          responseType: 'stream',
          headers: {
            'Content-Type': 'application/json',
            ...(requestId ? { 'X-Request-Id': requestId } : {})
          },
          timeout: requestTimeout,
          // 添加更詳細的超時配置
          httpsAgent: false,
          httpAgent: false,
          // 連接超時配置
          timeoutErrorMessage: `API 請求超時 (${requestTimeout}ms)`
        });

        logger.info(`API 請求成功，狀態碼: ${response.status}`);
        
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
                  logger.warn(`JSON 解析失敗: ${parseError.message}, 內容: ${content}`);
                  // 不中斷整個流程，僅記錄警告
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
