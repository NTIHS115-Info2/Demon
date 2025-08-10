const EventEmitter = require('events');
const Logger       = require('../utils/logger');
const logger       = new Logger('toolOutputRouter');
const PM           = require('./pluginsManager');
const PromptComposer = require('./PromptComposer');

/**
 * 嘗試從字串中擷取出合法的工具 JSON
 * 會回傳包含起訖位置的物件，方便移除
 * @param {string} buffer
 * @returns {{data:object,start:number,end:number}|null}
 */
function findToolJSON(buffer) {
  const start = buffer.indexOf('{');
  if (start === -1) return null;

  // 逐一尋找可能的結束點並嘗試解析
  for (let i = start + 1, depth = 1; i < buffer.length; i++) {
    if (buffer[i] === '{') depth++;
    if (buffer[i] === '}') depth--;
    if (depth === 0) {
      const slice = buffer.slice(start, i + 1);
      try {
        const obj = JSON.parse(slice);
        if (obj && obj.toolName) {
          return { data: obj, start, end: i + 1 };
        }
      } catch (_) {
        // 非完整 JSON，繼續檢查下一個可能的結尾
      }
    }
  }

  return null;
}

class ToolStreamRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.buffer  = '';
    this.timeout = options.timeout || 1500;
    this.processing = Promise.resolve();
  }

  feed(chunk) {
    if (chunk) this.buffer += chunk;
    this.processing = this.processing.then(() => this._parse());
    return this.processing;
  }

  async flush() {
    await this.feed();
    if (this.buffer) {
      this.emit('data', this.buffer);
      this.buffer = '';
    }
    this.emit('end');
  }

  async _parse() {
    while (true) {
      const found = findToolJSON(this.buffer);
      if (!found) {
        const safe = this.buffer.lastIndexOf('{');
        if (safe === -1) {
          if (this.buffer) this.emit('data', this.buffer);
          this.buffer = '';
        } else if (safe > 0) {
          this.emit('data', this.buffer.slice(0, safe));
          this.buffer = this.buffer.slice(safe);
        }
        break;
      }

      logger.info(`偵測到工具呼叫: ${found.data.toolName}`);
      const plain = this.buffer.slice(0, found.start);
      if (plain) this.emit('data', plain);
      this.buffer = this.buffer.slice(found.end);

      try {
        const message = await handleTool(found.data, {
          emitWaiting: (s) => this.emit('waiting', s),
          timeout: this.timeout
        });
        this.emit('tool', message);
        logger.info(`工具 ${found.data.toolName} 處理完成並發送結果`);
      } catch (err) {
        logger.error(`工具處理失敗: ${err.message}`);
      }
    }
  }
}

/**
 * 處理 LLM 輸出的工具呼叫
 * @param {string} text - LLM 輸出
 * @returns {Promise<{handled:boolean,content:string}>}
 */
async function routeOutput(text, options = {}) {
  return new Promise(resolve => {
    const router = new ToolStreamRouter(options);
    let handled = false;
    let output = '';
    router.on('data', chunk => output += chunk);
    router.on('tool', msg => { handled = true; output += msg.content; });
    router.on('end', () => resolve({ handled, content: output }));
    router.feed(text);
    router.flush();
  });
}

/**
 * 執行指定的工具並回傳給 PromptComposer
 * @param {object} toolData
 * @param {{emitWaiting:Function,timeout:number}} param1
 */
async function handleTool(toolData, { emitWaiting = () => {}, timeout = 10000 } = {}) {
  logger.info(`開始處理工具呼叫: ${toolData.toolName}`);
  
  const plugin = PM.getLLMPlugin(toolData.toolName) || PM.plugins.get(toolData.toolName);
  if (!plugin) {
    logger.warn(`找不到工具 ${toolData.toolName}`);
    return await PromptComposer.createToolMessage({
      called: true,
      toolName: toolData.toolName,
      success: false
    });
  }

  try {
    emitWaiting(true);
    logger.info(`執行工具 ${toolData.toolName}，參數: ${JSON.stringify(toolData)}`);
    
    const result = await Promise.race([
      PM.send(toolData.toolName, toolData.input),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);
    
    logger.info(`工具 ${toolData.toolName} 執行成功，結果: ${result}`);
    return await PromptComposer.createToolMessage({
      called: true,
      toolName: toolData.toolName,
      success: true,
      result
    });
  } catch (e) {
    const isTimeout = e.message === 'timeout';
    logger.error(`執行工具 ${toolData.toolName} ${isTimeout ? '逾時' : '失敗'}: ${e.message}`);
    
    return await PromptComposer.createToolMessage({
      called: true,
      toolName: toolData.toolName,
      success: false
    });
  } finally {
    emitWaiting(false);
    logger.info(`工具 ${toolData.toolName} 處理完成`);
  }
}

module.exports = { routeOutput, findToolJSON, handleTool, ToolStreamRouter };
