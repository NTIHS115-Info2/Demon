/**
 * messageValidator.js
 * 用於驗證與清理送往 vLLM/OpenAI 相容 API 的訊息結構
 * 確保二次回傳（工具結果回填）符合 OpenAI Chat Completion 規範
 */

const Logger = require('../../../../utils/logger');
const logger = new Logger('MessageValidator');

// 合法的 message role
const VALID_ROLES = Object.freeze(['system', 'user', 'assistant', 'tool']);

// 不得出現在請求 payload 中的欄位（僅用於回傳解析）
const FORBIDDEN_FIELDS = Object.freeze([
  'reasoning_content',
  'timestamp',
  'talker'
]);

/**
 * 驗證單一訊息是否符合 OpenAI 規範
 * @param {Object} msg - 訊息物件
 * @param {number} index - 訊息索引（用於 log）
 * @returns {{valid: boolean, errors: string[], cleaned: Object|null}}
 */
function validateMessage(msg, index = 0) {
  const errors = [];
  
  // 基本型別檢查
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: [`訊息 ${index} 不是有效物件`], cleaned: null };
  }

  // role 驗證
  if (!msg.role || typeof msg.role !== 'string') {
    errors.push(`訊息 ${index} 缺少 role 或 role 不是字串`);
  } else if (!VALID_ROLES.includes(msg.role)) {
    errors.push(`訊息 ${index} 的 role "${msg.role}" 不在允許清單 [${VALID_ROLES.join(', ')}]`);
  }

  // content 驗證
  if (msg.content === undefined || msg.content === null) {
    // OpenAI 規範：assistant 訊息若有 tool_calls，content 可為 null
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // 允許 content 為 null
    } else {
      errors.push(`訊息 ${index} 缺少 content`);
    }
  } else if (typeof msg.content !== 'string') {
    // 嘗試自動轉換為字串
    logger.warn(`訊息 ${index} 的 content 不是字串，嘗試轉換`);
  }

  // assistant role 特殊驗證：若有 tool_calls 需檢查格式
  if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
    for (let i = 0; i < msg.tool_calls.length; i++) {
      const tc = msg.tool_calls[i];
      if (!tc || typeof tc !== 'object') {
        errors.push(`訊息 ${index} 的 tool_calls[${i}] 不是有效物件`);
        continue;
      }
      if (!tc.id || typeof tc.id !== 'string') {
        errors.push(`訊息 ${index} 的 tool_calls[${i}] 缺少 id`);
      }
      if (!tc.function || typeof tc.function !== 'object') {
        errors.push(`訊息 ${index} 的 tool_calls[${i}] 缺少 function`);
      } else {
        if (!tc.function.name || typeof tc.function.name !== 'string') {
          errors.push(`訊息 ${index} 的 tool_calls[${i}].function 缺少 name`);
        }
      }
    }
  }

  // tool role 特殊驗證
  if (msg.role === 'tool') {
    if (!msg.name || typeof msg.name !== 'string') {
      errors.push(`訊息 ${index} role=tool 但缺少 name 欄位`);
    }
    // tool_call_id 建議但非必要（視 vLLM 版本）
    if (!msg.tool_call_id) {
      logger.warn(`訊息 ${index} role=tool 但無 tool_call_id（某些 API 可能需要）`);
    }
  }

  // 檢查是否有禁止欄位
  const foundForbidden = FORBIDDEN_FIELDS.filter(f => msg[f] !== undefined);
  if (foundForbidden.length > 0) {
    logger.warn(`訊息 ${index} 包含將被移除的欄位: ${foundForbidden.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    cleaned: null // 將在 cleanMessage 中處理
  };
}

/**
 * 清理單一訊息，移除不合法欄位並確保格式正確
 * @param {Object} msg - 原始訊息
 * @param {number} index - 索引
 * @returns {Object|null} - 清理後的訊息，無效時回傳 null
 */
function cleanMessage(msg, index = 0) {
  if (!msg || typeof msg !== 'object') {
    logger.warn(`[cleanMessage] 訊息 ${index} 無效，跳過`);
    return null;
  }

  // 基本欄位
  const role = msg.role;
  if (!role || !VALID_ROLES.includes(role)) {
    logger.warn(`[cleanMessage] 訊息 ${index} role="${role}" 無效，跳過`);
    return null;
  }

  // content 處理：確保是字串（assistant 有 tool_calls 時允許 null）
  let content = msg.content;
  if (content === undefined || content === null) {
    if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // OpenAI 規範：assistant 訊息若有 tool_calls，content 可為 null
      content = null;
    } else {
      logger.warn(`[cleanMessage] 訊息 ${index} content 為空，設為空字串`);
      content = '';
    }
  } else if (typeof content !== 'string') {
    try {
      content = JSON.stringify(content);
      logger.info(`[cleanMessage] 訊息 ${index} content 已轉換為 JSON 字串`);
    } catch (err) {
      content = String(content);
      logger.warn(`[cleanMessage] 訊息 ${index} content 轉換失敗，使用 String(): ${err.message}`);
    }
  }

  // 建立乾淨的訊息物件
  const cleaned = {
    role
  };
  
  // content 僅在非 null 時加入（OpenAI 允許 assistant 有 tool_calls 時 content 為 null）
  if (content !== null) {
    cleaned.content = content;
  } else {
    cleaned.content = null; // 明確設為 null
  }

  // tool role 專屬欄位
  if (role === 'tool') {
    if (msg.name && typeof msg.name === 'string') {
      cleaned.name = msg.name;
    } else {
      logger.error(`[cleanMessage] 訊息 ${index} role=tool 但 name 無效，跳過此訊息`);
      return null;
    }
    
    // tool_call_id 若有則保留
    if (msg.tool_call_id && typeof msg.tool_call_id === 'string') {
      cleaned.tool_call_id = msg.tool_call_id;
    }
  }

  // assistant role 可能有 tool_calls（若模型支援 function calling）
  if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
    cleaned.tool_calls = msg.tool_calls;
  }

  return cleaned;
}

/**
 * 清理並驗證整個訊息陣列
 * @param {Array} messages - 原始訊息陣列
 * @returns {Array} - 清理後的訊息陣列
 */
function cleanAndValidateMessages(messages) {
  if (!Array.isArray(messages)) {
    logger.error('[cleanAndValidateMessages] 輸入不是陣列');
    throw new Error('messages 必須是陣列');
  }

  logger.info(`[cleanAndValidateMessages] 開始處理 ${messages.length} 則訊息`);

  const cleaned = [];
  const skipped = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // 先驗證
    const validation = validateMessage(msg, i);
    if (!validation.valid) {
      logger.warn(`[cleanAndValidateMessages] 訊息 ${i} 驗證失敗: ${validation.errors.join('; ')}`);
    }

    // 清理
    const cleanedMsg = cleanMessage(msg, i);
    if (cleanedMsg) {
      cleaned.push(cleanedMsg);
    } else {
      skipped.push(i);
    }
  }

  if (skipped.length > 0) {
    logger.warn(`[cleanAndValidateMessages] 跳過 ${skipped.length} 則無效訊息: 索引 [${skipped.join(', ')}]`);
  }

  logger.info(`[cleanAndValidateMessages] ✓ 完成，${cleaned.length}/${messages.length} 則訊息通過`);

  // 額外檢查：確保至少有一則訊息
  if (cleaned.length === 0) {
    logger.error('[cleanAndValidateMessages] 清理後無有效訊息');
    throw new Error('清理後無有效訊息');
  }

  // 額外檢查：第一則應為 system
  if (cleaned[0].role !== 'system') {
    logger.warn('[cleanAndValidateMessages] ⚠️ 第一則訊息不是 system role');
  }

  // 額外檢查：tool 訊息前應有 assistant 訊息（或 user）
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i].role === 'tool' && i > 0) {
      const prevRole = cleaned[i - 1].role;
      if (prevRole !== 'assistant' && prevRole !== 'tool') {
        logger.warn(`[cleanAndValidateMessages] ⚠️ tool 訊息 ${i} 前一則不是 assistant/tool (是 ${prevRole})`);
      }
    }
  }

  return cleaned;
}

/**
 * 驗證完整的 chat payload
 * @param {Object} payload - 要送出的 payload
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateChatPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['payload 不是有效物件'] };
  }

  // messages 檢查
  if (!Array.isArray(payload.messages)) {
    errors.push('payload.messages 不是陣列');
  } else if (payload.messages.length === 0) {
    errors.push('payload.messages 為空');
  }

  // model 檢查（可選但建議）
  if (payload.model && typeof payload.model !== 'string') {
    errors.push('payload.model 應為字串');
  }

  // stream 檢查
  if (payload.stream !== undefined && typeof payload.stream !== 'boolean') {
    errors.push('payload.stream 應為布林值');
  }

  // 檢查 messages 內是否有禁止欄位
  if (Array.isArray(payload.messages)) {
    payload.messages.forEach((msg, idx) => {
      FORBIDDEN_FIELDS.forEach(field => {
        if (msg[field] !== undefined) {
          errors.push(`messages[${idx}] 含有禁止欄位 "${field}"`);
        }
      });
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 用於除錯：格式化輸出完整 payload
 * @param {Object} payload 
 * @returns {string}
 */
function formatPayloadForLog(payload) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch (err) {
    return `[無法序列化: ${err.message}]`;
  }
}

module.exports = {
  VALID_ROLES,
  FORBIDDEN_FIELDS,
  validateMessage,
  cleanMessage,
  cleanAndValidateMessages,
  validateChatPayload,
  formatPayloadForLog
};
