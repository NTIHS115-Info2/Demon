const fileEditer = require('../tools/fileEditer');
const Logger = require('../utils/logger');

const logger = new Logger('PromptComposer');

/**
 * 取得預設系統提示
 * @returns {Promise<string>}
 */
async function GetDefaultSystemPrompt() {
  return new Promise(async (resolve, reject) => {
    try {
      const DefaultSystemPrompt = await fileEditer.GetFilesContent(__dirname + '/soulPresets');

      let result = '';
      DefaultSystemPrompt.forEach(element => {
        result += element + '\n';
      });

      logger.info(`成功讀取預設系統提示：${DefaultSystemPrompt.length} 個提示`);
      logger.info(`預設系統提示內容：\n${result}`);
      resolve(result);
    } catch (error) {
      logger.error(`讀取預設系統提示失敗：${error.message}`);
      reject(error);
    }
  });
}

/**
 * 組合工具回傳內容
 * @param {{called?:boolean,toolName?:string,success?:boolean,result?:any}} state
 * @returns {Promise<string>}
 */
async function composeToolPrompt(state = {}) {
  let info = '';
  if (state.called) {
    info += `工具 ${state.toolName} 已執行。`;
    if (state.success && state.result !== undefined) {
      info += `結果為: ${state.result}`;
    } else if (!state.success) {
      info += '執行失敗或逾時。';
    }
  }
  return info;
}

/**
 * 產生工具訊息物件
 * @param {object} state
 * @returns {Promise<{role:string,content:string,timestamp:number}>}
 */
async function createToolMessage(state = {}) {
  const content = await composeToolPrompt(state);
  return {
    role: 'tool',
    content,
    timestamp: Date.now()
  };
}

/**
 * 組合最終送入 LLM 的訊息陣列
 * @param {Array<{role:string,content:string}>} history - 對話歷史
 * @param {Array<{role:string,content:string}>} tools - 工具訊息歷史
 * @param {Array<{role:string,content:string}>} [extra] - 其他要附加的訊息
 * @returns {Promise<Array<{role:string,content:string}>>}
 */
async function composeMessages(history = [], tools = [], extra = []) {
  let base = '';
  try {
    base = await GetDefaultSystemPrompt();
  } catch (err) {
    logger.warn(`取得預設系統提示失敗：${err.message}`);
  }

  const result = [{ role: 'system', content: base }];
  for (const msg of history) {
    result.push({ role: msg.role, content: msg.content });
  }
  for (const msg of tools) {
    result.push({ role: msg.role, content: msg.content });
  }
  for (const msg of extra) {
    result.push({ role: msg.role, content: msg.content });
  }
  return result;
}

module.exports = {
  GetDefaultSystemPrompt,
  composeToolPrompt,
  createToolMessage,
  composeMessages
};
