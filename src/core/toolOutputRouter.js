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
// 替換：findToolJSON，改用字串/跳脫感知的掃描邏輯
function findToolJSON(buffer) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const slice = buffer.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          if (
            obj && typeof obj === 'object' &&
            typeof obj.toolName === 'string' &&
            Object.prototype.hasOwnProperty.call(obj, 'input') &&
            Object.keys(obj).every(k => ['toolName', 'input'].includes(k))
          ) {
            return { data: obj, start, end: i + 1 };
          }
        } catch (_) {
          // 不是合法 JSON，忽略，繼續往後找
        }
        // 若不是我們要的 JSON，繼續掃描下一段
        start = -1;
      }
    }
  }
  return null;
}

// 新增：計算大括號深度，忽略字串與跳脫字元；回傳 { depth, lastOpenIndex }
function braceBalance(str) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastOpenIndex = -1;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) lastOpenIndex = i;
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return { depth, lastOpenIndex };
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

  // 修改：flush() 不再硬吐出殘缺 JSON；提供 force 參數
  async flush({ force = false } = {}) {
    await this.feed(); // 觸發一次 parse

    if (!this.buffer) {
      this.emit('end');
      return;
    }

    const { depth } = braceBalance(this.buffer);
    if (depth === 0 || force) {
      // 平衡（或強制）才輸出剩餘文字
      this.emit('data', this.buffer);
      this.buffer = '';
    } else {
      // 預設情況下保留，避免殘缺 JSON 被輸出
      logger.info('flush 遇到未完結 JSON，已保留於內部緩衝（未 force）。');
    }
    this.emit('end');
  }

  // 修改：_parse() 在無完整 JSON 時，只丟出「安全區段」
  async _parse() {
    while (true) {
      const found = findToolJSON(this.buffer);
      if (!found) {
        const { depth, lastOpenIndex } = braceBalance(this.buffer);

        if (depth === 0) {
          // 全部都是安全文字，直接吐出
          if (this.buffer) this.emit('data', this.buffer);
          this.buffer = '';
        } else {
          // 只輸出最後一個「可能 JSON」開頭之前的安全片段
          const safeLen = Math.max(0, lastOpenIndex);
          if (safeLen > 0) {
            this.emit('data', this.buffer.slice(0, safeLen));
            this.buffer = this.buffer.slice(safeLen);
          }
          // 保留未完結 JSON 片段於 buffer，等待後續 chunk
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

  // 確認 input 欄位存在，避免傳遞不完整的參數
  if (!Object.prototype.hasOwnProperty.call(toolData, 'input')) {
    logger.warn(`工具 ${toolData.toolName} 呼叫缺少 input 欄位`);
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

    logger.info(`工具 ${toolData.toolName} 執行成功，結果: ${logger.safeStringify(result)}`);
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
