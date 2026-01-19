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
      // 檢查是否位於行首（允許前置空白），否則視為零散反引號
      let j = i - 1;
      while (j >= 0 && (buffer[j] === ' ' || buffer[j] === '\t')) j--;
      const atLineStart = j < 0 || buffer[j] === '\n' || buffer[j] === '\r';
      if (atLineStart) inCode = !inCode; // 行首三重反引號視為 Markdown 代碼界線
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
            obj && typeof obj === 'object' && !Array.isArray(obj) &&
            typeof obj.toolName === 'string' &&
            Object.prototype.hasOwnProperty.call(obj, 'input')
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

  // 小工具：判斷 ``` 是否在「視為行首」的位置
  // 視為行首：真正行首 / 前置空白 / 區塊引用 '>'（可多重）/ 常見清單符號 -,*,+ 或數字. 之後可有空白
  function atLogicalLineStart(s, idx) {
    let j = idx - 1;
    // 回到上一行結尾或字串開頭
    while (j >= 0 && s[j] !== '\n' && s[j] !== '\r') j--;
    j++; // 移到行首第一個字元
    // 跳過空白
    while (j < idx && (s[j] === ' ' || s[j] === '\t')) j++;
    // 跳過區塊引用 '>'（可多個），每個之後可有空白
    while (j < idx && s[j] === '>') {
      j++;
      while (j < idx && (s[j] === ' ' || s[j] === '\t')) j++;
    }
    // 跳過清單符號 -,*,+ 或數字.（可選），之後可有空白
    if (j < idx && (s[j] === '-' || s[j] === '*' || s[j] === '+')) {
      j++;
      if (j < idx && (s[j] === ' ' || s[j] === '\t')) {
        while (j < idx && (s[j] === ' ' || s[j] === '\t')) j++;
      }
    } else {
      // 有序清單形式：digits + '.' + 空白*
      let k = j;
      let seenDigit = false;
      while (k < idx && s[k] >= '0' && s[k] <= '9') { seenDigit = true; k++; }
      if (seenDigit && k < idx && s[k] === '.') {
        k++;
        while (k < idx && (s[k] === ' ' || s[k] === '\t')) k++;
        j = k;
      }
    }
    return j === idx;
  }

  for (let i = 0; i < str.length - 2; i++) {
    if (str[i] === '`' && str[i+1] === '`' && str[i+2] === '`') {
      if (atLogicalLineStart(str, i)) {
        if (!inCode) {
          inCode = true;
          lastOpenIndex = i;
        } else {
          inCode = false;
        }
      }
      i += 2;
    }
  }
  // 不再根據內容（是否為工具 JSON）改變 inCode；只看 fence 配對。
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
    if (found) {
      // 回傳絕對位置
      return { data: found.data, start: open, end: close + 3 };
    }

    search = close + 3;
  }
}

class ToolStreamRouter extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.timeout=80000] - 工具執行超時（毫秒）
   * @param {string} [options.source='content'] - 來源標記（'content' 或 'reasoning'）
   */
  constructor(options = {}) {
    super();
    this.buffer  = '';
    this.timeout = options.timeout || 80_000;
    this.source  = options.source || 'content';  // ★ 標記來源
    this.maxTools = Number.isInteger(options.maxTools) ? options.maxTools : 1;
    this.dropUnfinishedToolJson = options.dropUnfinishedToolJson !== false;
    this.shouldExecuteTool = typeof options.shouldExecuteTool === 'function' ? options.shouldExecuteTool : null;
    this._toolCount = 0;
    this.processing = Promise.resolve();
  }

  feed(chunk) {
    if (chunk) this.buffer += chunk;
    this.processing = this.processing.then(() => this._parse());
    return this.processing;
  }

  // 修改：flush() 不再硬吐出殘缺 JSON；提供 force 參數
  async flush({ force = false, dropUnfinishedToolJson } = {}) {
    await this.feed(); // 觸發一次 parse

    if (!this.buffer) {
      this.emit('end');
      return;
    }
    const { depth } = braceBalance(this.buffer);
    const { inCode } = backtickState(this.buffer);
    const dropPartial = dropUnfinishedToolJson !== undefined
      ? dropUnfinishedToolJson
      : this.dropUnfinishedToolJson;

    if (depth === 0 && !inCode) {
      this.emit('data', this.buffer);
      this.buffer = '';
    } else if (force) {
      if (!dropPartial) {
        this.emit('data', this.buffer);
      } else {
        logger.info('flush 遇到未完結 JSON 或 Markdown 代碼區塊，已丟棄殘片（force + dropUnfinishedToolJson）。');
      }
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

      // ★ 詳細記錄工具偵測資訊（用於除錯與追蹤）
      const toolDetectionInfo = {
        source: this.source,
        toolName: found.data.toolName,
        input: found.data.input,
        markdown: !!found.markdown,
        chunkPosition: { start: found.start, end: found.end },
        bufferLengthBefore: this.buffer.length,
        timestamp: Date.now()
      };
      logger.info(`[tool-detection] 來源=${this.source}, 工具=${found.data.toolName}, Markdown包裹=${found.markdown || false}`);
      logger.info(`[tool-detection-detail] ${JSON.stringify(toolDetectionInfo)}`);

      // 取出工具呼叫前的純文字區段
      const plain = this.buffer.slice(0, found.start);
      if (plain) this.emit('data', plain);

      // 移除已處理段落
      this.buffer = this.buffer.slice(found.end);

      if (this.maxTools >= 0 && this._toolCount >= this.maxTools) {
        logger.warn(`[tool-skip] 已達 maxTools=${this.maxTools}，忽略後續工具呼叫`);
        continue;
      }

      if (this.shouldExecuteTool && !this.shouldExecuteTool(found.data, toolDetectionInfo)) {
        logger.warn(`[tool-skip] 外部限制拒絕工具 ${found.data.toolName}`);
        continue;
      }

      try {
        const message = await handleTool(found.data, {
          emitWaiting: (s) => this.emit('waiting', s, {
            tool: { name: found.data.toolName, source: this.source },
            detection: toolDetectionInfo
          }),
          timeout: this.timeout
        });
        this._toolCount += 1;
        // ★ 發射 tool 事件時帶上來源與偵測資訊
        this.emit('tool', message, { source: this.source, detection: toolDetectionInfo });
        logger.info(`[tool-executed] 來源=${this.source}, 工具=${found.data.toolName} 處理完成`);

        if (this.maxTools >= 0 && this._toolCount >= this.maxTools) {
          // 只接受一個工具呼叫，剩餘內容直接丟棄避免副作用
          this.buffer = '';
          break;
        }
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
async function handleTool(toolData, { emitWaiting = () => {}, timeout = 80_000 } = {}) {
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

    // 若插件回傳包含 error (非 null/undefined) 或 success 為 false，視為失敗並回傳錯誤
    if (result && (result.error || result.success === false)) {
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
