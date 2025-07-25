const Logger = require('../utils/logger');
const logger = new Logger('toolOutputRouter');
const PM = require('./pluginsManager');
const PromptComposer = require('./PromptComposer');

/**
 * 嘗試解析 LLM 輸出中的工具資訊
 * @param {string} text
 * @returns {object|null}
 */
function parseToolJSON(text) {
  try {
    const data = JSON.parse(text);
    if (!data.toolName || !data.toolResultTarget) return null;
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * 處理 LLM 輸出的工具呼叫
 * @param {string} text - LLM 輸出
 * @returns {Promise<{handled:boolean,target:string,content:string}>}
 */
async function routeOutput(text, options = {}) {
  const setBusy = options.setBusy || (() => {});
  const timeout = options.timeout || 1500;
  const toolData = parseToolJSON(text);
  if (!toolData) {
    return { handled: false, target: 'user', content: text };
  }
  const plugin = PM.getLLMPlugin(toolData.toolName) || PM.plugins.get(toolData.toolName);
  if (!plugin) {
    logger.warn(`找不到工具 ${toolData.toolName}`);
    const prompt = await PromptComposer.composeSystemPrompt({
      called: true,
      toolName: toolData.toolName,
      success: false
    });
    return { handled: true, target: 'llm', content: prompt };
  }

  try {
    setBusy(true);
    const result = await Promise.race([
      PM.send(toolData.toolName, toolData),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);
    const toolState = {
      called: true,
      toolName: toolData.toolName,
      success: true,
      result
    };
    if (toolData.toolResultTarget === 'llm') {
      const prompt = await PromptComposer.composeSystemPrompt(toolState);
      return { handled: true, target: 'llm', content: prompt };
    }
    return { handled: true, target: 'user', content: String(result) };
  } catch (e) {
    if (e.message === 'timeout') {
      logger.warn(`工具 ${toolData.toolName} 執行逾時`);
    } else {
      logger.error(`執行工具 ${toolData.toolName} 失敗: ${e.message}`);
    }
    const prompt = await PromptComposer.composeSystemPrompt({
      called: true,
      toolName: toolData.toolName,
      success: false
    });
    return { handled: true, target: 'llm', content: prompt };
  } finally {
    setBusy(false);
  }
}

module.exports = { routeOutput };
