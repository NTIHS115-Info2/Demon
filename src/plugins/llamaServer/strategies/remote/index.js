const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const GlobalErrorHandler = require('../../../../utils/globalErrorHandler');
const { cleanAndValidateMessages, validateChatPayload } = require('./messageValidator');
// ★ 已移除 ResponseEventParser import（改回 chat/completions）

const logger = new Logger('LlamaRemote');

// 遠端策略的連線設定（由策略初始化時注入）
let baseUrl = '';
let remoteModel = 'gpt-oss-120b';
let requestTimeout = 30000;
let requestId = '';

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

// OpenAI 相容 API 路徑設定
const OPENAI_PATHS = Object.freeze({
  MODELS: '/v1/models',
  CHAT_COMPLETIONS: '/v1/chat/completions',
  RESPONSES: '/v1/responses'  // ★ 新增 responses API 路徑
});

// API 模式設定
const API_MODE = Object.freeze({
  CHAT_COMPLETIONS: 'chat'     // ★ 使用 /v1/chat/completions
});

// 遠端請求預設設定，允許在線上啟動或請求時覆寫
const runtimeConfig = {
  timeout: ERROR_CONFIG.REQUEST_TIMEOUT,
  req_id: null,
  req_id_header: 'X-Request-Id',
  model: null,
  apiMode: API_MODE.CHAT_COMPLETIONS  // ★ 使用 chat/completions API
};

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
      requestId = options.req_id || '';
      logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
      if (remoteModel) {
        logger.info(`Llama remote 已設定 model: ${remoteModel}`);
      }
      if (requestId) {
        logger.info(`Llama remote 已設定 req_id: ${requestId}`);
      }
      return true;
    } catch (error) {
      logger.error(`啟動 Llama remote 失敗: ${error.message}`);
      throw error;
    }
  },

  /** 停止遠端策略 */
  async offline() {
    baseUrl = '';
    remoteModel = '';
    requestTimeout = ERROR_CONFIG.REQUEST_TIMEOUT;
    requestId = '';
    logger.info('Llama remote 已關閉');
    return true;
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
   * ★ 使用 /v1/chat/completions API（OpenAI Chat Completions）
   * @param {Array|Object} payload - 傳遞給 Llama 的訊息陣列或設定物件
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
    let dataTimeout = null;
    // 建立 AbortController 以支援中斷請求
    const controller = new AbortController();

    // 正規化輸入參數與必要欄位
    const normalizedOptions = normalizeSendOptions(options);
    
    // 解析每次請求可覆寫的 timeout 與 req_id 設定
    const requestConfig = resolveRuntimeConfig(
      typeof options === 'object' && !Array.isArray(options) ? options : {},
      runtimeConfig
    );
    const reqId = requestConfig.req_id;

    // ★ 使用 /v1/chat/completions API
    const url = buildOpenAiUrl(OPENAI_PATHS.CHAT_COMPLETIONS);
    
    // ★ 建立 chat/completions API payload（不送 tools/tool_choice）
    const payload = buildChatPayload({
      messages: normalizedOptions.messages,
      model: normalizedOptions.model,
      stream: true,
      // ★ 不送 tools/tool_choice（使用偽協議）
      params: normalizedOptions.params || {}
    });

    logger.info(`開始 /v1/chat/completions 請求: ${url}`);
    logger.info(`請求參數: ${JSON.stringify({ messageCount: payload.messages?.length || 0 })}`);
    if (reqId) {
      logger.info(`本次請求使用 req_id: ${reqId}`);
    }

    // 處理串流回應的請求流程
    const attemptStreamRequest = async () => {
      // 若已中止則不再發送請求
      if (aborted) {
        return;
      }
      try {
        logger.info(`/v1/chat/completions 請求嘗試 ${retryCount + 1}/${ERROR_CONFIG.MAX_RETRIES + 1}`);

        // 組合請求標頭
        const headers = {
          'Content-Type': 'application/json',
          ...(reqId ? { [requestConfig.req_id_header]: reqId } : {})
        };
        
        // 詳細記錄完整 payload
        logger.info(`[chat/completions] 完整請求 payload:\n${JSON.stringify(payload, null, 2)}`);
        
        const response = await axios({
           url,
           method: 'POST',
           data: payload,
           responseType: 'stream',
           headers,
           timeout: requestConfig.timeout,
           signal: controller.signal,
           timeoutErrorMessage: `API 請求超時 (${requestConfig.timeout}ms)`
        });

        logger.info(`/v1/chat/completions 請求成功，狀態碼: ${response.status}`);

        // 確認串流物件存在
        if (!response.data || typeof response.data.on !== 'function') {
          const streamError = new Error('遠端回應未提供可用的串流資料');
          logger.error(streamError.message);
          emitter.emit('error', streamError);
          return;
        }
        
        stream = response.data;
        let buffer = '';
        let dataReceived = false;

        // 設置資料接收超時
        dataTimeout = setTimeout(() => {
          if (!dataReceived && !aborted) {
            const timeoutError = createTypedError({
              type: ERROR_TYPES.TIMEOUT,
              message: 'API 資料接收超時',
              reqId,
              phase: 'stream-timeout',
              url
            });
            logger.error('長時間未收到 API 資料，可能發生超時');
            emitter.emit('error', timeoutError);
          }
        }, ERROR_CONFIG.CONNECTION_TIMEOUT);

        stream.on('data', chunk => {
          if (aborted) return;

          dataReceived = true;
          clearTimeout(dataTimeout);
          
          try {
            buffer += chunk.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop();
            
            for (const line of lines) {
              if (!line.startsWith('data:')) {
                continue;
              }

              const content = line.replace(/^data:\s*/, '').trim();
              if (!content || content === '[DONE]') {
                if (content === '[DONE]') {
                  logger.info('[chat/completions] 收到 [DONE] 信號');
                }
                continue;
              }

              try {
                const json = JSON.parse(content);
                
                // ★ 標準 chat/completions 格式解析
                const normalized = normalizeCompletionChunk(json);
                const text = extractCompletionContent(normalized);
                const reasoning = extractReasoningContent(normalized);
                
                // ★ 只要有 text 或 reasoning 就發送 data 事件
                // reasoning_content 中可能包含工具呼叫，必須傳遞給上層偵測
                if (text || reasoning) {
                  emitter.emit('data', text || '', normalized, reasoning || null);
                }
                
                // ★ 記錄 reasoning_content（用於除錯）
                if (reasoning) {
                  logger.info(`[chat/completions-reasoning] ${reasoning}`);
                }
                
              } catch (parseError) {
                logger.warn(`JSON 解析失敗: ${parseError.message}, 內容: ${content}`);
              }
            }
          } catch (error) {
            const dataError = createTypedError({
              type: ERROR_TYPES.SERVER,
              message: `處理串流資料時發生錯誤: ${error.message}`,
              reqId,
              phase: 'data-processing',
              url,
              originalError: error
            });
            logger.error(`處理串流資料時發生錯誤: ${error.message}`);
            emitter.emit('error', dataError);
          }
        });

        stream.on('end', () => {
          clearTimeout(dataTimeout);
          
          if (aborted) return;
          
          logger.info('/v1/chat/completions 串流結束');
          emitter.emit('end');
        });

        stream.on('error', (streamError) => {
          clearTimeout(dataTimeout);
          if (aborted) return;
          
          const classifiedError = classifyError(streamError, {
            reqId,
            phase: 'stream-error',
            url
          });
          logger.error(`串流錯誤: ${streamError.message}`);
          emitter.emit('error', classifiedError);
        });

      } catch (error) {
        if (aborted) return;
        
        logger.error(`/v1/chat/completions 請求失敗: ${error.message}`);
        
        const shouldRetry = shouldRetryError(error, retryCount);
        
        if (shouldRetry) {
          retryCount++;
          const delay = ERROR_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retryCount - 1);
          logger.info(`${delay}ms 後進行重試...`);
          
          setTimeout(() => {
            attemptStreamRequest();
          }, delay);
        } else {
          const classifiedError = classifyError(error, {
            reqId,
            phase: 'request',
            url
          });
          
          GlobalErrorHandler.logError(error, {
            module: 'LlamaRemote',
            method: 'send',
            url,
            retryCount,
            req_id: reqId
          });
          
          emitter.emit('error', classifiedError);
        }
      }
    };

    // 啟動串流請求流程
    attemptStreamRequest();

    emitter.abort = () => {
      aborted = true;
      logger.info('收到中止請求');
      clearTimeout(dataTimeout);
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
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 正規化送出參數，確保包含 model 與 messages
 * ★ 支援 tools、tool_choice 與 previous_response_id 參數
 * @param {Array|Object} options
 * @returns {{messages:Array, model:string, stream:boolean, tools:Array|null, tool_choice:string|Object|null, previous_response_id:string|null, params:Object}}
 */
function normalizeSendOptions(options) {
  const resolvedModel = resolveDefaultModel(
    Array.isArray(options) ? {} : (options || {}),
    runtimeConfig
  );
  // 預設值設定，避免輸入異常造成錯誤
  const defaultOptions = {
    messages: [],
    model: resolvedModel,
    stream: true,
    tools: null,
    tool_choice: null,
    previous_response_id: null,  // ★ 新增：用於 multi-turn conversation
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
    model = resolvedModel,
    stream = true,
    tools = null,
    tool_choice = null,
    previous_response_id = null,  // ★ 新增
    ...rest
  } = options;

  return {
    messages: Array.isArray(messages) ? messages : [],
    model,
    stream: Boolean(stream),
    tools: Array.isArray(tools) && tools.length > 0 ? tools : null,
    tool_choice: tool_choice || null,
    previous_response_id: previous_response_id || null,  // ★ 新增
    params: rest
  };
}

/**
 * 組裝 chat/completions 的 payload
 * 新增：支援 tools 與 tool_choice 參數
 * @param {{messages:Array, model:string, stream:boolean, tools:Array|null, tool_choice:string|Object|null, params:Object}} options
 * @returns {Object}
 */
function buildChatPayload(options) {
  // 清理並驗證 messages，確保符合 OpenAI 規範
  logger.info(`[buildChatPayload] 開始清理 ${options.messages?.length || 0} 則訊息`);
  
  let cleanedMessages = [];
  try {
    cleanedMessages = cleanAndValidateMessages(options.messages || []);
    logger.info(`[buildChatPayload] 清理完成，保留 ${cleanedMessages.length} 則合法訊息`);
  } catch (err) {
    logger.error(`[buildChatPayload] 訊息清理失敗: ${err.message}`);
    throw new Error(`訊息驗證失敗: ${err.message}`);
  }
  
  // 組合必要欄位與額外參數
  const payload = {
    messages: cleanedMessages,
    ...options.params
  };

  if (options.model) {
    payload.model = options.model;
  }

  // 明確指定 stream 旗標以符合需求
  payload.stream = options.stream;

  // 加入 tools 與 tool_choice（OpenAI function calling 支援）
  if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
    payload.tools = options.tools;
    logger.info(`[buildChatPayload] 加入 ${options.tools.length} 個工具定義`);
    
    // 設定 tool_choice，預設為 "auto"
    if (options.tool_choice) {
      payload.tool_choice = options.tool_choice;
    } else {
      payload.tool_choice = 'auto';
    }
    logger.info(`[buildChatPayload] tool_choice: ${typeof payload.tool_choice === 'string' ? payload.tool_choice : JSON.stringify(payload.tool_choice)}`);
  }

  // 驗證完整 payload
  const validation = validateChatPayload(payload);
  if (!validation.valid) {
    const errMsg = `Payload 驗證失敗: ${validation.errors.join('; ')}`;
    logger.error(`[buildChatPayload] ${errMsg}`);
    throw new Error(errMsg);
  }

  // 詳細記錄完整 payload 用於除錯（尤其是二次請求時）
  try {
    logger.info(`[buildChatPayload] ✓ Payload 驗證通過`);
    logger.info(`[buildChatPayload] 完整請求 payload:\n${JSON.stringify(payload, null, 2)}`);
  } catch (err) {
    logger.warn(`[buildChatPayload] 無法序列化 payload: ${err.message}`);
  }

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
 * 從回應中提取 reasoning_content
 * @param {Object} raw
 * @returns {string}
 */
function extractReasoningContent(raw) {
  return raw?.choices?.[0]?.delta?.reasoning_content
    || raw?.choices?.[0]?.reasoning_content
    || raw?.reasoning_content
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
  const reasoningContent = extractReasoningContent(raw);
  const rawChoice = Array.isArray(raw?.choices) ? raw.choices[0] : undefined;

  if (!Array.isArray(normalized.choices) || normalized.choices.length === 0) {
    normalized.choices = [{ delta: { content }, finish_reason: rawChoice?.finish_reason || null }];
  } else {
    const choice = normalized.choices[0] || {};
    choice.delta = choice.delta || {};
    if (!choice.delta.content && content) {
      choice.delta.content = content;
    }
    if (!choice.delta.reasoning_content && reasoningContent) {
      choice.delta.reasoning_content = reasoningContent;
    }
    if (!choice.finish_reason && rawChoice?.finish_reason) {
      choice.finish_reason = rawChoice.finish_reason;
    }
    normalized.choices[0] = choice;
  }

  if (!normalized.content && content) {
    normalized.content = content;
  }

  if (!normalized.reasoning_content && reasoningContent) {
    normalized.reasoning_content = reasoningContent;
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
 * 解析預設 model 來源，支援 options / config / env
 * @param {Object} options - 請求或啟動時的設定
 * @param {Object} baseConfig - 既有預設設定
 * @returns {string|null}
 */
function resolveDefaultModel(options = {}, baseConfig = {}) {
  // 允許從 options、config 或環境變數覆寫預設 model
  try {
    const config = options.config || {};
    const resolvedModel = options.model
      ?? config.model
      ?? config.remote?.model
      ?? process.env.LLAMA_REMOTE_MODEL
      ?? baseConfig.model
      ?? null;
    return resolvedModel || null;
  } catch (error) {
    logger.warn(`解析預設 model 失敗，改用預設值: ${error.message}`);
    return baseConfig.model || null;
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


