const EventEmitter = require('events');
const Logger       = require('../utils/logger');
const logger       = new Logger('toolOutputRouter');
const PM           = require('./pluginsManager');
const PromptComposer = require('./PromptComposer');

/**
 * 嘗試從字串中擷取出合法的工具 JSON
 * 會回傳包含起訖位置的物件，方便移除
 * 會忽略尚未閉合的 Markdown 代碼區塊
 * @param {string} buffer
 * @returns {{data:object,start:number,end:number}|null}
 */
function findToolJSON(buffer) {
  let inString = false;   // 是否位於字串中
  let escaped  = false;   // 是否處於跳脫字元狀態
  let depth    = 0;       // 大括號深度
  let start    = -1;      // 紀錄 JSON 起始位置
  let inCode   = false;   // 是否位於 Markdown 代碼區塊

  for (let i = 0; i < buffer.length; i++) {
    // 先判斷 Markdown 代碼區塊界線，但需忽略字串內的反引號
    if (!inString && buffer.startsWith('```', i)) {
      inCode = !inCode;
      i += 2; // 跳過其餘兩個反引號
      continue;
    }

    if (inCode) continue; // 代碼區塊內的 JSON 交由其他流程處理

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
          // 非合法 JSON，忽略並持續掃描
        }
        // 未符合工具格式，重置起始位置
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

// 新增：追蹤 Markdown 代碼區塊是否閉合，回傳 { inCode, lastOpenIndex }
function backtickState(str) {
  let inCode = false;
  let lastOpenIndex = -1;
  for (let i = 0; i < str.length - 2; i++) {
    if (str.slice(i, i + 3) === '```') {
      if (!inCode) {
        // 取得語言標記（允許 "```json" 或無標記）
        const after = str.slice(i + 3);
        const match = after.match(/^([a-zA-Z]*)[\t\r\n ]*/);
        const lang  = (match && match[1] || '').toLowerCase();
        const rest  = after.slice(match ? match[0].length : 0).trimStart();
        if (lang === 'json' || (lang === '' && rest.startsWith('{'))) {
          inCode = true;
          lastOpenIndex = i;
        }
      } else {
        // 已在代碼區塊中，遇到結束反引號時關閉
        inCode = false;
      }
      i += 2;
    }
  }
  // 若仍在 JSON 代碼區塊內，檢查內容是否為非工具的完整 JSON
  if (inCode) {
    try {
      const after = str.slice(lastOpenIndex + 3);
      const match = after.match(/^([a-zA-Z]*)[\t\r\n ]*/); // 語言標記
      const rest  = after.slice(match ? match[0].length : 0);
      const trimmed = rest.trim();
      const tool = findToolJSON(trimmed);
      JSON.parse(trimmed); // 若解析失敗，將落入 catch
      if (!tool) inCode = false; // 非工具 JSON，放行
    } catch (_) {
      // 保留 inCode 狀態，等待後續資料補齊
    }
  }
  return { inCode, lastOpenIndex };
}

// 新增：尋找被 Markdown 包裹的工具 JSON
function findMarkdownTool(buffer) {
  let search = 0;
  while (true) {
    const open = buffer.indexOf('```', search);
    if (open === -1) return null;
    const close = buffer.indexOf('```', open + 3);
    if (close === -1) return null; // 尚未收到結束反引號，等待後續資料

    const inside = buffer.slice(open + 3, close);
    let content = inside.trimStart();
    // 忽略語言標記，例如 json
    content = content.replace(/^json\b/i, '').trimStart();
    if (!content.startsWith('{')) {
      search = close + 3; // 非 JSON，繼續往後尋找
      continue;
    }

    const found = findToolJSON(content);
    if (found && content.slice(found.end).trim() === '') {
      // 回傳絕對位置
      return { data: found.data, start: open, end: close + 3 };
    }

    search = close + 3;
  }
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
    const { inCode } = backtickState(this.buffer);
    if ((depth === 0 && !inCode) || force) {
      // 平衡（或強制）才輸出剩餘文字
      this.emit('data', this.buffer);
      this.buffer = '';
    } else {
      // 預設情況下保留，避免殘缺 JSON 或 Markdown 被輸出
      logger.info('flush 遇到未完結 JSON 或 Markdown 代碼區塊，已保留於內部緩衝（未 force）。');
    }
    this.emit('end');
  }

  // 修改：_parse() 在無完整 JSON 時，只丟出「安全區段」
  async _parse() {
    while (true) {
      const mdFound = findMarkdownTool(this.buffer);
      const jsonFound = findToolJSON(this.buffer);
      let found;
      if (mdFound && (!jsonFound || mdFound.start <= jsonFound.start)) {
        found = { ...mdFound, markdown: true };
      } else {
        found = jsonFound;
      }

      if (!found) {
        const brace   = braceBalance(this.buffer);
        const back    = backtickState(this.buffer);

        if (brace.depth === 0 && !back.inCode) {
          // 全部都是安全文字，直接吐出
          if (this.buffer) this.emit('data', this.buffer);
          this.buffer = '';
        } else {
          // 只輸出未開啟區段之前的安全片段
          const indices = [];
          if (brace.depth > 0) indices.push(brace.lastOpenIndex);
          if (back.inCode)     indices.push(back.lastOpenIndex);
          const safeLen = Math.min(...indices);
          if (safeLen > 0) {
            this.emit('data', this.buffer.slice(0, safeLen));
            this.buffer = this.buffer.slice(safeLen);
          }
          // 未完結區段保留於 buffer
        }
        break;
      }

      logger.info(`偵測到${found.markdown ? ' Markdown 包裹的' : ''}工具呼叫: ${found.data.toolName}`);

      // 取出工具呼叫前的純文字區段
      const plain = this.buffer.slice(0, found.start);
      if (plain) this.emit('data', plain);

      // 移除已處理段落
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
    
    // 建立工具執行與逾時計時，並於完成後清除計時器
    const toolPromise = PM.send(toolData.toolName, toolData.input);
    const timeoutPromise = new Promise((_, reject) => {
      const id = setTimeout(() => reject(new Error('timeout')), timeout);
      toolPromise.finally(() => clearTimeout(id));
    });
    const result = await Promise.race([toolPromise, timeoutPromise]);

    // 若插件回傳包含 error 或 success 為 false，視為失敗並回傳錯誤
    if (result && (result.error !== undefined || result.success === false)) {
      const errMsg = result.error || '未知錯誤';
      logger.warn(`工具 ${toolData.toolName} 回傳錯誤: ${errMsg}`);
      return await PromptComposer.createToolMessage({
        called: true,
        toolName: toolData.toolName,
        success: false,
        error: errMsg,
        value: result.value
      });
    }

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
      success: false,
      error: e.message
    });
  } finally {
    emitWaiting(false);
    logger.info(`工具 ${toolData.toolName} 處理完成`);
  }
}

module.exports = { routeOutput, findToolJSON, handleTool, ToolStreamRouter };
