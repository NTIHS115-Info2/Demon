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
  
  if (!message.content || typeof message.content !== 'string') {
    throw new Error('訊息必須包含有效的內容 (content)');
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

    const DefaultToolList = `\n=== 以下為工具清單 ===${await PM.send('toolReference')}=== 工具清單結束 ===`;

    let result = '';
    DefaultSystemPrompt.forEach(element => {
      if (typeof element === 'string') {
        result += element + '\n';
      }
    });

    result += DefaultToolList; // 加入工具清單

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
 * @param {{called?:boolean,toolName?:string,success?:boolean,result?:any}} state
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
        const resultStr = typeof state.result === 'string' 
          ? state.result 
          : JSON.stringify(state.result);
        info += `結果為: ${resultStr}`;
      } else if (state.success === false) {
        info += '執行失敗或逾時。';
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
 * @param {object} state
 * @returns {Promise<{role:string,content:string,timestamp:number}>}
 */
async function createToolMessage(state = {}) {
  try {
    const content = await composeToolPrompt(state);
    const message = {
      role: MESSAGE_ROLES.TOOL,
      content,
      timestamp: Date.now()
    };
    
    // 驗證產生的訊息
    validateMessage(message);
    
    return message;
  } catch (error) {
    logger.error(`建立工具訊息失敗：${error.message}`);
    // 回傳安全的錯誤訊息
    return {
      role: MESSAGE_ROLES.TOOL,
      content: `工具訊息產生失敗：${error.message}`,
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
  
  return messages.filter((msg, index) => {
    try {
      validateMessage(msg);
      return true;
    } catch (error) {
      logger.warn(`訊息 ${index} 格式不正確，已跳過：${error.message}`);
      return false;
    }
  });
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
    const validToolResults = validateAndCleanMessages(toolResultBuffer);
    if (validToolResults.length > 0) {
      // 按時間戳排序工具結果
      validToolResults.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      result.push(...validToolResults);
      logger.info(`加入了 ${validToolResults.length} 個工具結果`);
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
      logger.warn('第一個訊息不是系統訊息，這可能影響LLM行為');
    }

    logger.info(`成功組合訊息陣列：${finalMessages.length} 則訊息`);
    logger.info(`訊息類型分布：${getMessageTypeDistribution(finalMessages)}`);
    
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
