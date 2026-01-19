const fileEditer = require('../tools/fileEditer');

const PM = require('./pluginsManager');

const Logger = require('../utils/logger');

const logger = new Logger('PromptComposer');

// 訊息角色常數
const MESSAGE_ROLES = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool'
};

// 不得出現在送往 LLM 的 payload 中的欄位
const FORBIDDEN_PAYLOAD_FIELDS = [
  'reasoning_content',
  'timestamp',
  'talker'
];

/**
 * 清理訊息物件，移除不合法欄位，確保符合 OpenAI 規範
 * @param {Object} message - 原始訊息
 * @returns {Object} - 清理後的訊息
 */
function cleanMessageForPayload(message) {
  if (!message || typeof message !== 'object') {
    return message;
  }

  const { role, content, name, tool_call_id, tool_calls } = message;
  
  // ★ 使用偵測协議時，工具結果以 user role 送出
  // （不使用 OpenAI 原生 tool_calls）
  const safeRole = role;
  
  // 建立乾淨的訊息物件，只保留合法欄位
  const cleaned = { role: safeRole };
  
  // content 處理：assistant 有 tool_calls 時允許 null
  if (content !== undefined && content !== null) {
    cleaned.content = typeof content === 'string' ? content : JSON.stringify(content);
  } else if (role === MESSAGE_ROLES.ASSISTANT && Array.isArray(tool_calls) && tool_calls.length > 0) {
    // OpenAI 規範：assistant 訊息若有 tool_calls，content 可為 null
    cleaned.content = null;
  } else {
    cleaned.content = '';
  }
  
  // ★ user role 且有 tool_call_id 表示這是工具結果訊息
  if (role === MESSAGE_ROLES.USER && tool_call_id) {
    if (name && typeof name === 'string') {
      cleaned.name = name;
    }
    if (tool_call_id && typeof tool_call_id === 'string') {
      cleaned.tool_call_id = tool_call_id;
    }
  }
  
  // assistant 可能有 tool_calls
  if (role === MESSAGE_ROLES.ASSISTANT && Array.isArray(tool_calls)) {
    cleaned.tool_calls = tool_calls;
  }
  
  return cleaned;
}

// 驗證訊息格式
function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('訊息必須是物件格式');
  }
  
  if (!message.role || typeof message.role !== 'string') {
    throw new Error('訊息必須包含有效的角色 (role)');
  }
  
  if (!Object.values(MESSAGE_ROLES).includes(message.role)) {
    throw new Error(`不支援的訊息角色: ${message.role}`);
  }
  
  // content 驗證：assistant 有 tool_calls 時允許 null
  const hasToolCalls = message.role === MESSAGE_ROLES.ASSISTANT && 
                       Array.isArray(message.tool_calls) && 
                       message.tool_calls.length > 0;
  
  if (!hasToolCalls && (!message.content || typeof message.content !== 'string')) {
    throw new Error('訊息必須包含有效的內容 (content)');
  }
  
  // ★ user role 且有 tool_call_id 時的特殊驗證（工具結果訊息）
  if (message.role === MESSAGE_ROLES.USER && message.tool_call_id) {
    if (!message.name || typeof message.name !== 'string') {
      throw new Error('工具結果訊息必須包含有效的 name 欄位');
    }
    
    if (!message.tool_call_id) {
      logger.warn('工具結果訊息建議包含 tool_call_id 欄位');
    }
  }
  
  return true;
}

/**
 * 取得預設系統提示
 * @returns {Promise<string>}
 */
async function GetDefaultSystemPrompt() {
  try {
    const DefaultSystemPrompt = await fileEditer.GetFilesContent(__dirname + '/soulPresets');

    if (!Array.isArray(DefaultSystemPrompt)) {
      throw new Error('系統提示檔案讀取結果格式錯誤');
    }

    // 從 toolReference 取得粗略的工具清單，用於系統提示
    let toolListText = '';
    try {
      const toolResponse = await PM.send('toolReference', { roughly: true });
      if (toolResponse?.success && Array.isArray(toolResponse.tools)) {
        if (toolResponse.tools.length === 0) {
          toolListText = '（目前沒有可用工具）';
        } else {
          toolListText = toolResponse.tools
            .map(item => `- ${item.toolName}（${item.pluginName}）: ${item.description}`)
            .join('\n');
        }
      } else if (toolResponse?.error) {
        toolListText = `工具描述載入失敗：${toolResponse.error}`;
      } else {
        toolListText = '工具描述載入失敗：未取得有效回應';
      }
    } catch (err) {
      logger.error(`載入工具描述清單失敗：${err.message}`);
      toolListText = `工具描述載入失敗：${err.message}`;
    }

    // 另外拉取 toolReference 自身的完整說明，確保 LLM 每輪對話都掌握使用規則
    let toolReferenceGuide = '';
    try {
      const detailResponse = await PM.send('toolReference', { toolName: 'toolReference' });
      if (detailResponse?.success && Array.isArray(detailResponse.tools) && detailResponse.tools.length > 0) {
        const guide = detailResponse.tools[0].definition || {};
        const usageLines = Array.isArray(guide.usage)
          ? guide.usage.filter(text => typeof text === 'string').map((text, index) => `${index + 1}. ${text}`)
          : [];
        const inputLines = guide.input && typeof guide.input === 'object'
          ? Object.entries(guide.input).map(([key, text]) => `- ${key}: ${text}`)
          : [];
        const outputLines = guide.output && typeof guide.output === 'object'
          ? Object.entries(guide.output).map(([key, text]) => `- ${key}: ${text}`)
          : [];
        const noteLines = Array.isArray(guide.notes)
          ? guide.notes.map((text, index) => `${index + 1}. ${text}`)
          : [];

        const sections = [];
        if (guide.description) sections.push(`描述：${guide.description}`);
        if (usageLines.length > 0) sections.push(`使用步驟：\n${usageLines.join('\n')}`);
        if (inputLines.length > 0) sections.push(`輸入參數：\n${inputLines.join('\n')}`);
        if (outputLines.length > 0) sections.push(`輸出欄位：\n${outputLines.join('\n')}`);
        if (noteLines.length > 0) sections.push(`注意事項：\n${noteLines.join('\n')}`);

        toolReferenceGuide = sections.length > 0
          ? sections.join('\n\n')
          : '未能解析 toolReference 的詳細說明內容。';
      } else if (detailResponse?.error) {
        toolReferenceGuide = `toolReference 使用說明載入失敗：${detailResponse.error}`;
      } else {
        toolReferenceGuide = 'toolReference 使用說明載入失敗：未取得有效回應';
      }
    } catch (err) {
      logger.error(`載入 toolReference 詳細說明失敗：${err.message}`);
      toolReferenceGuide = `toolReference 使用說明載入失敗：${err.message}`;
    }

    const DefaultToolList = `\n=== 以下為工具清單 ===\n${toolListText}\n=== 工具清單結束 ===`;
    const ToolReferenceInstruction = `\n=== toolReference 使用說明 ===\n${toolReferenceGuide}\n=== 說明結束 ===`;

    let result = '';
    DefaultSystemPrompt.forEach(element => {
      if (typeof element === 'string') {
        result += element + '\n';
      }
    });

    result += DefaultToolList; // 加入工具清單
    result += ToolReferenceInstruction; // 加入 toolReference 詳細說明

    if (!result.trim()) {
      logger.warn('系統提示內容為空，使用預設提示');
      result = '你是一個專業的AI助手。請以友善、專業的方式回應使用者的問題。';
    }

    logger.info(`成功讀取預設系統提示：${DefaultSystemPrompt.length} 個提示`);
    return result.trim();
  } catch (error) {
    logger.error(`讀取預設系統提示失敗：${error.message}`);
    // 提供備用系統提示
    const fallbackPrompt = '你是一個專業的AI助手。請以友善、專業的方式回應使用者的問題。';
    logger.warn('使用備用系統提示');
    return fallbackPrompt;
  }
}

/**
 * 組合工具回傳內容
 * @param {{called?:boolean,toolName?:string,success?:boolean,result?:any,error?:string,value?:any}} state
 * @returns {Promise<string>}
 */
async function composeToolPrompt(state = {}) {
  try {
    if (!state || typeof state !== 'object') {
      throw new Error('工具狀態參數必須是物件格式');
    }

    let info = '';
    if (state.called) {
      if (!state.toolName || typeof state.toolName !== 'string') {
        throw new Error('工具名稱不能為空且必須是字串格式');
      }
      
      info += `工具 ${state.toolName} 已執行。`;
      
      if (state.success === true && state.result !== undefined) {
        // 成功時輸出結果內容
        const resultStr = typeof state.result === 'string'
          ? state.result
          : JSON.stringify(state.result);
        info += `結果為: ${resultStr}`;
      } else if (state.success === false) {
        // 失敗時輸出錯誤訊息，並於有值時附帶 value
        const errMsg = state.error || '未知錯誤';
        info += `執行失敗：${errMsg}`;
        if (state.value !== undefined) {
          const valStr = typeof state.value === 'string'
            ? state.value
            : JSON.stringify(state.value);
          info += `，附帶值: ${valStr}`;
        }
        info += '。';
      }
    }
    
    return info;
  } catch (error) {
    logger.error(`組合工具提示失敗：${error.message}`);
    return `工具執行狀態異常：${error.message}`;
  }
}

/**
 * 產生工具訊息物件
 * @param {{called?:boolean,toolName?:string,success?:boolean,result?:any,error?:string,value?:any}} state
 * @returns {Promise<{role:string,name:string,content:string,tool_call_id:string,timestamp:number}>}
 */
async function createToolMessage(state = {}) {
  try {
    if (!state.toolName || typeof state.toolName !== 'string') {
      throw new Error('toolName 必須是有效字串');
    }

    const content = await composeToolPrompt(state);
    
    // 確保 content 是字串
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    
    // 生成符合偵測協議的 user 訊息
    const message = {
      role: MESSAGE_ROLES.USER,  // ★ 改成 user
      name: state.toolName,
      content: contentStr,
      tool_call_id: state.tool_call_id || `call_${state.toolName}_${Date.now()}`,
      timestamp: Date.now()
    };
    
    // 驗證產生的訊息
    validateMessage(message);
    
    logger.info(`✓ 成功建立工具訊息: ${state.toolName}`);
    logger.info(`工具訊息內容: ${JSON.stringify(message, null, 2)}`);
    
    return message;
  } catch (error) {
    logger.error(`建立工具訊息失敗：${error.message}`);
    // 回傳安全的錯誤訊息
    const json = JSON.stringify({
      toolResult: {
        toolName: state?.toolName || 'unknown_tool',
        called: true,
        success: false,
        error: error.message || 'unknown_error'
      }
    }, null, 2);
    return {
      role: MESSAGE_ROLES.USER,  // ★ 改成 user
      name: state.toolName || 'unknown_tool',
      content: `\n\n\`\`\`json\n${json}\n\`\`\`\n`,
      tool_call_id: `call_error_${Date.now()}`,
      timestamp: Date.now()
    };
  }
}

/**
 * 驗證並清理訊息陣列
 * @param {Array} messages 
 * @returns {Array}
 */
function validateAndCleanMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('訊息必須是陣列格式');
  }
  
  const cleaned = [];
  
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    try {
      validateMessage(msg);
      // 驗證通過後，清理掉不合法欄位
      const cleanedMsg = cleanMessageForPayload(msg);
      cleaned.push(cleanedMsg);
    } catch (error) {
      logger.warn(`訊息 ${index} 格式不正確，已跳過：${error.message}`);
    }
  }
  
  return cleaned;
}

/**
 * 組合最終送入 LLM 的訊息陣列
 * 順序：系統提示詞 → 歷史訊息 → 工具結果 → 額外訊息
 * @param {Array<{role:string,content:string}>} history - 對話歷史
 * @param {Array<{role:string,content:string}>} toolResultBuffer - 工具結果緩衝區
 * @param {Array<{role:string,content:string}>} [extra] - 其他要附加的訊息
 * @returns {Promise<Array<{role:string,content:string}>>}
 */
async function composeMessages(history = [], toolResultBuffer = [], extra = []) {
  try {
    // 參數驗證和預設值
    if (!Array.isArray(history)) {
      logger.warn('歷史參數不是陣列，使用空陣列');
      history = [];
    }
    if (!Array.isArray(toolResultBuffer)) {
      logger.warn('工具結果緩衝區不是陣列，使用空陣列');
      toolResultBuffer = [];
    }
    if (!Array.isArray(extra)) {
      logger.warn('額外訊息參數不是陣列，使用空陣列');
      extra = [];
    }

    // 1. 建立系統提示詞
    const systemPrompt = await GetDefaultSystemPrompt();
    const result = [{
      role: MESSAGE_ROLES.SYSTEM,
      content: systemPrompt
    }];

    // 2. 驗證並加入歷史訊息
    const validHistory = validateAndCleanMessages(history);
    result.push(...validHistory);

    // 3. 驗證並加入工具結果緩衝區
    // 注意：先排序再清理，因為 cleanMessageForPayload 會移除 timestamp
    let sortedToolResults = [...toolResultBuffer];
    sortedToolResults.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const validToolResults = validateAndCleanMessages(sortedToolResults);
    
    if (validToolResults.length > 0) {
      result.push(...validToolResults);
      logger.info(`✓ 加入了 ${validToolResults.length} 個工具結果到 messages`);
      
      // 詳細記錄每個工具訊息（用於除錯二次回傳）
      validToolResults.forEach((msg, idx) => {
        logger.info(`  [Tool ${idx}] role="${msg.role}", name="${msg.name}", content 長度=${msg.content?.length || 0}`);
        logger.info(`  [Tool ${idx}] 完整內容: ${JSON.stringify(msg, null, 2)}`);
      });
    } else if (toolResultBuffer.length > 0) {
      logger.warn(`⚠️ toolResultBuffer 有 ${toolResultBuffer.length} 個項目，但驗證後為空，將以安全模式強制注入`);
      const forced = toolResultBuffer.map((msg, idx) => {
        const cleaned = cleanMessageForPayload(msg);
        logger.warn(`  [forced ToolResult ${idx}] role="${cleaned.role}", name="${cleaned.name || ''}", tool_call_id="${cleaned.tool_call_id || ''}", content 長度=${cleaned.content?.length || 0}`);
        return cleaned;
      }).filter(Boolean);
      if (forced.length > 0) {
        result.push(...forced);
        logger.warn(`⚠️ 已強制注入 ${forced.length} 個工具結果訊息（role: user, 使用偽協議）`);
      }
      // 輸出原始 toolResultBuffer 供除錯
      toolResultBuffer.forEach((msg, idx) => {
        logger.warn(`  [原始 Tool ${idx}] role="${msg.role}", name="${msg.name}", keys=${Object.keys(msg).join(',')}`);
      });
    }

    // 4. 加入額外訊息
    const validExtra = validateAndCleanMessages(extra);
    result.push(...validExtra);

    // 5. 最終驗證整個訊息陣列
    const finalMessages = validateAndCleanMessages(result);
    
    // 6. 確保符合 LLM 需求的基本格式檢查
    if (finalMessages.length === 0) {
      throw new Error('最終訊息陣列為空');
    }
    
    if (finalMessages[0].role !== MESSAGE_ROLES.SYSTEM) {
      logger.warn('⚠️ 第一個訊息不是系統訊息，這可能影響LLM行為');
    }

    // 檢查是否包含工具結果訊息（判斷是否為二次回傳）
    const hasToolMessages = finalMessages.some(m => m.role === MESSAGE_ROLES.USER && m.tool_call_id);
    if (hasToolMessages) {
      logger.info(`🔧 此為工具回傳的二次請求，共 ${finalMessages.filter(m => m.role === MESSAGE_ROLES.USER && m.tool_call_id).length} 個工具結果訊息（偽協議）`);
      
      // 二次回傳時，輸出完整 payload 供除錯
      logger.info(`📦 [二次回傳] 完整 messages payload (pretty print):`);
      try {
        const payloadStr = JSON.stringify(finalMessages, null, 2);
        logger.info(payloadStr);
      } catch (err) {
        logger.error(`[二次回傳] 無法序列化 payload: ${err.message}`);
      }
      
      // 驗證每個訊息的欄位是否合法
      finalMessages.forEach((msg, idx) => {
        const forbiddenFound = FORBIDDEN_PAYLOAD_FIELDS.filter(f => msg[f] !== undefined);
        if (forbiddenFound.length > 0) {
          logger.error(`❌ [二次回傳] messages[${idx}] 含有禁止欄位: ${forbiddenFound.join(', ')}`);
        }
        if (msg.role === MESSAGE_ROLES.USER && msg.tool_call_id && !msg.name) {
          logger.error(`❌ [二次回傳] messages[${idx}] 工具結果訊息（role=user, tool_call_id存在）但缺少 name`);
        }
        if (msg.content !== undefined && typeof msg.content !== 'string') {
          logger.error(`❌ [二次回傳] messages[${idx}] content 不是字串 (是 ${typeof msg.content})`);
        }
      });
    }

    logger.info(`✓ 成功組合訊息陣列：${finalMessages.length} 則訊息`);
    logger.info(`📊 訊息類型分布：${getMessageTypeDistribution(finalMessages)}`);
    
    // 詳細輸出最終 messages（用於除錯）
    try {
      logger.info(`📋 最終 messages 結構:\n${JSON.stringify(finalMessages, null, 2)}`);
    } catch (err) {
      logger.warn(`無法序列化最終 messages: ${err.message}`);
    }
    
    return finalMessages;

  } catch (error) {
    logger.error(`組合訊息陣列失敗：${error.message}`);
    
    // 提供最小可用的訊息陣列作為備用
    try {
      const fallbackSystemPrompt = await GetDefaultSystemPrompt();
      return [{
        role: MESSAGE_ROLES.SYSTEM,
        content: fallbackSystemPrompt
      }];
    } catch (fallbackError) {
      logger.error(`備用訊息陣列也失敗：${fallbackError.message}`);
      return [{
        role: MESSAGE_ROLES.SYSTEM,
        content: '你是一個專業的AI助手。'
      }];
    }
  }
}

/**
 * 取得訊息類型分布統計
 * @param {Array} messages 
 * @returns {string}
 */
function getMessageTypeDistribution(messages) {
  const distribution = {};
  messages.forEach(msg => {
    distribution[msg.role] = (distribution[msg.role] || 0) + 1;
  });
  return Object.entries(distribution)
    .map(([role, count]) => `${role}: ${count}`)
    .join(', ');
}

module.exports = {
  GetDefaultSystemPrompt,
  composeToolPrompt,
  createToolMessage,
  composeMessages,
  validateMessage,
  MESSAGE_ROLES
};
