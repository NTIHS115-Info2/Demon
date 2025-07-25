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
 * 根據工具執行狀態組合 system prompt
 * @param {{called?:boolean,toolName?:string,success?:boolean,result?:any}} state
 */
async function composeSystemPrompt(state = {}) {
  const base = await GetDefaultSystemPrompt();
  let info = '';
  if (state.called) {
    info += `工具 ${state.toolName} 已執行。`;
    if (state.success && state.result !== undefined) {
      info += `結果為: ${state.result}`;
    } else if (!state.success) {
      info += '執行失敗或逾時。';
    }
  }
  return base + (info ? `\n[工具狀態]\n${info}` : '');
}

module.exports = { GetDefaultSystemPrompt, composeSystemPrompt };
