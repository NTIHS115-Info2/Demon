// TalkToDemonManager.js
// ──────────────────────────────────────────────────────────────
// ★ 對話管理器：管理 /v1/chat/completions API 的完整生命週期
// 工具呼叫使用「偽協議」：由 ToolStreamRouter 偵測文字輸出中的 JSON
const { EventEmitter }          = require('events');
const { composeMessages }       = require('./PromptComposer.js');
const PM                        = require('./pluginsManager.js');
const Logger                    = require('../utils/logger.js');
const historyManager            = require('./historyManager');
const toolOutputRouter          = require('./toolOutputRouter');
// ★ 已移除 getToolsSchema import（不使用原生 tool_calls）

// 參數
const MAX_HISTORY     = 50;
const EXPIRY_TIME_MS  = 10 * 60 * 1000; // 10 分鐘

// ★ 工具執行上限
const MAX_TOOL_ROUNDS = 5;

// ★ 已移除 CONVERSATION_MODE（改回 chat/completions，使用 history replay）

// ────────────────── 1. 串流處理器 ────────────────────────────
class LlamaStreamHandler extends EventEmitter {
  constructor() {
    super();
    this.llamaEmitter = null;   // PM.send 回傳的 EventEmitter
    this.stopped      = false;
    this.logger       = new Logger('LlamaStream.log');
    this.reasoningBuffer = '';
    this.responseId   = null;   // ★ 儲存 response ID（用於 multi-turn）
    this._onData = null;
    this._onEnd = null;
    this._onError = null;
  }

  /**
   * 啟動串流
   * @param {Array<{role:string,content:string}>} messages
   * @param {Object} options - 額外選項（如 tools, tool_choice, previous_response_id）
   */
  async start(messages, options = {}) {
    this.stopped = false;
    this.reasoningBuffer = '';
    this.responseId = null;

    try {

      this.logger.info('[串流開始] 正在向 llamaServer 發送請求...');
      this.logger.info(`請求內容：`);
      this.logger.info(messages);

      // 組合請求參數，支援 tools、tool_choice 與 previous_response_id
      const requestPayload = {
        messages,
        stream: true,
        ...options
      };

      if (options.tools && options.tools.length > 0) {
        this.logger.info(`[串流] 使用 ${options.tools.length} 個工具定義`);
      }
      if (options.previous_response_id) {
        this.logger.info(`[串流] 繼續前一個 response: ${options.previous_response_id}`);
      }

      const emitter = await PM.send('llamaServer', requestPayload);          // ★向插件請求串流資料

      this.logger.Original(emitter);

      if (!emitter || !(emitter instanceof EventEmitter)) {
        throw new Error('llamaServer 未回傳有效 EventEmitter');
      }

      this.llamaEmitter = emitter;

      this._onData = (chunk, raw, reasoning) => {
        if (this.stopped) return;
        const text = chunk == null ? '' : String(chunk);
        const reasoningText = reasoning
          || raw?.choices?.[0]?.delta?.reasoning_content
          || raw?.choices?.[0]?.reasoning_content
          || raw?.reasoning_content
          || '';

        if (reasoningText) {
          this.reasoningBuffer += reasoningText;
          this.logger.info(`[Llama][reasoning] ${reasoningText}`);
        }

        this.emit('data', text, raw, reasoningText);
        if (text) {
          this.logger.info(`[Llama] 回應: ${text}`);
        }
      };
      emitter.on('data', this._onData);

      // ★ 已移除 tool_calls 事件監聽（不使用原生 tool_calls）
      // 工具呼叫改用「偽協議」：由 ToolStreamRouter 偵測文字輸出

      // ★ 已移除 response_done 事件監聽（改回 chat/completions，無此事件）

      this._onEnd = () => {
        if (!this.stopped) {
          this.stopped = true;
          this._detachEmitter();
          this.emit('end');
        }
      };
      emitter.on('end', this._onEnd);

      this._onError = err => {
        if (!this.stopped) {
          this.stopped = true;
          this._detachEmitter();
          this.emit('error', err);
        }
      };
      emitter.on('error', this._onError);

    } catch (err) {
      this.emit('error', err);
    }
  }

  /** 停止串流 */
  stop() {
    if (this.stopped) return;

    this.stopped = true;
    this.logger.info('[串流中止]');

    if (this.llamaEmitter) {
      // 若插件支援中止，優先調用
      if (typeof this.llamaEmitter.abort === 'function') {
        try {
          this.llamaEmitter.abort();   // ★ 呼叫 pluginsManager 回傳物件的 abort 方法
        } catch (err) {
          this.logger.warn(`[中止失敗] 無法 abort: ${err.message}`);
        }
        this._detachEmitter();
      } else {
        // 不支援 abort() 時，採取溫和 fallback
        this.llamaEmitter.removeAllListeners();
      }
    }

    this.emit('abort');
  }

  _detachEmitter() {
    if (!this.llamaEmitter) return;
    if (this._onData) this.llamaEmitter.off('data', this._onData);
    if (this._onEnd) this.llamaEmitter.off('end', this._onEnd);
    if (this._onError) this.llamaEmitter.off('error', this._onError);
  }
}


// ────────────────── 2. 對話管理器（Response Orchestrator）───────────────────────────
class TalkToDemonManager extends EventEmitter {
  constructor(model = 'Demon') {
    super();
    this.model         = model;
    this.history       = [];          // { role, content, timestamp }
    this.pendingQueue  = [];
    this.processing    = false;
    this.currentTask   = null;
    this.currentHandler= null;
    this.logger        = new Logger('TalkToDemon.log');
    this.gateOpen      = true;
    this.gateBuffer    = '';
    this.toolResultBuffer = [];       // 工具訊息暫存
    this.waitingForTool   = false;    // 是否正等待工具完成
    this._needCleanup     = false;    // 工具結果是否待清除
    this.phaseId       = 0;   // 同一任務（工具前/後）同一 phase
    this._phaseRound   = 0;   // 同一 phase 下的 round 計數
    this._waitingHold  = false; // 鎖住 waiting=true 直到該輪 end
    this._toolBusy     = false; // 工具執行中（由 Router waiting 事件驅動）
    this._endDeferred  = false; // end-latch：忙碌時先到的 end 會延後處理
    // ★ 目前正在執行的工具（給前端狀態顯示用）
    this._activeTool   = null; // { name, source, detection }
    
    // ★ 工具執行狀態
    this._toolRoundCount = 0;        // 當前任務的工具執行輪數
    
    // ★ 已移除 _currentResponseId、_conversationMode、_pendingToolResults
    // （改回 chat/completions，使用 history replay）

    
    // 保底 error handler，避免無 listener 時炸掉 process
    this.prependListener('error', (err) => {
      if (this.listenerCount('error') === 1) {
        this.logger.error('[Unhandled Talker Error]', err);
        this.emit('unhandled_error', err);
      }
    });
  }

  /*─── 工具函式 ──────────────────────────────────────────*/
  _pruneHistory() {
    const now = Date.now();
    this.history = this.history.filter(m => now - m.timestamp <= EXPIRY_TIME_MS);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }


  /*─── 外部呼叫：talk() ───────────────────────────────────*/
  /**
   * @param {string} talker - 說話者識別（用於前綴 <talker> ）
   * @param {string} content - 使用者內容
   * @param {{uninterruptible?:boolean, important?:boolean}} options
   */
  talk(talker = '其他', content = '', options = {}) {
    const { uninterruptible=false, important=false } = options;
    const userMsg = { role:'user', content:`${talker}： ${content}`, talker, timestamp:Date.now() };

    // 寫入持久化歷史
    historyManager.appendMessage(talker, 'user', userMsg.content).catch(e => {
      this.logger.warn('[history] 紀錄使用者訊息失敗: ' + e.message);
    });

    this._pruneHistory();
    this.history.push(userMsg);

    const task = { message:userMsg, uninterruptible, important };

    if (!this.processing) {
      this.gateOpen  = true;
      this.gateBuffer= '';
      this._processNext(task);
    } else {
      if (uninterruptible) {
        this.logger.info('[忽略] 不可打斷訊息且目前忙碌');
      } else if (important) {
        this.logger.info('[排隊] 重要訊息加入佇列');
        this.pendingQueue.push(task);
      } else {
        this.logger.info('[中斷] 以新訊息取代當前對話');
        this.currentHandler?.stop();
        this._processNext(task);
      }
    }
  }

  /*─── 核心：執行下一個任務 ───────────────────────────────*/
  async _processNext(task) {
    this.processing   = true;
    // phase 控制：使用者新請求 phase+1；工具回合沿用同一 phase
    if (!task._keepPhase) {
      this.phaseId++;
      this._toolRoundCount = 0;  // ★ 新任務重置工具輪數
      this._phaseRound = 1;
    } else {
      this._phaseRound = Math.max(1, this._phaseRound + 1);
    }
    this.currentTask  = task;

    // ★ 進入新一輪：預設先視為 thinking（直到第一個 delta 進來）
    this._setWaiting(false, { state: 'thinking', usingTool: false, reason: task._keepPhase ? 'post_tool_round_start' : 'round_start' });

    // 讀取持久化歷史，失敗時以空陣列處理
    let persistHistory = [];
    try {
      persistHistory = await historyManager.getHistory(task.message.talker, MAX_HISTORY);
    } catch (err) {
      this.logger.warn('[history] 讀取歷史失敗: ' + err.message);
    }

    // 合併歷史與當前訊息，再加入暫存的工具結果
    this.history = [...persistHistory, task.message];
    this._pruneHistory();

    // ★ 已移除 toolsSchema 載入（不使用原生 tool_calls）
    // 工具呼叫改用「偽協議」：由 ToolStreamRouter 偵測文字輸出

    // composeMessages 可能因參數錯誤拋出例外，須捕捉以免整個流程中斷
    let messages;
    try {
      messages = await composeMessages(this.history, this.toolResultBuffer);
    } catch (err) {
      this.logger.error('[錯誤] 組合訊息失敗: ' + err.message);
      this._finalizeWithError(err, { reason: 'compose_failed' });
      return;
    }

    const handler = new LlamaStreamHandler(this.model);
    this.currentHandler = handler;
    let toolExecutionLocked = false;
    const shouldExecuteTool = () => {
      if (toolExecutionLocked) return false;
      toolExecutionLocked = true;
      return true;
    };
    const router = new toolOutputRouter.ToolStreamRouter({
      source: 'content',
      maxTools: 1,
      dropUnfinishedToolJson: true,
      shouldExecuteTool
    });
    // reasoning 會被視為「思考」，會額外串流給前端（但不會混入 talk）
    const reasoningRouter = new toolOutputRouter.ToolStreamRouter({
      source: 'reasoning',
      maxTools: 1,
      dropUnfinishedToolJson: true,
      shouldExecuteTool
    });
    let assistantBuf = '';
    let reasoningBuf = '';
    let toolTriggered = false;
    let postToolAbort = false;
    let roundEndEmitted = false;
    const emitRoundEnd = () => {
      if (roundEndEmitted) return;
      roundEndEmitted = true;
      this.emit('round_end', {
        phaseId: this.phaseId,
        round: this._phaseRound,
        toolTriggered: true
      });
    };

    const handleWaiting = (s, meta = {}) => {
      this._toolBusy = !!s;
      if (s) {
        if (meta.tool && !this._activeTool) {
          this._activeTool = {
            name: meta.tool.name || 'unknown',
            source: meta.tool.source || 'unknown',
            detection: meta.detection || null
          };
        }
        this._setWaiting(true, {
          reason: 'tool_busy',
          state: 'using_tool',
          usingTool: true,
          tool: this._activeTool
            ? { name: this._activeTool.name, source: this._activeTool.source }
            : (meta.tool ? { name: meta.tool.name, source: meta.tool.source } : null)
        });
        this.closeGate(); // 擋住第一輪「請等一下」之類的雜訊
      } else {
        this._setWaiting(false, {
          reason: 'tool_idle',
          state: 'thinking',
          usingTool: false,
          tool: this._activeTool
            ? { name: this._activeTool.name, source: this._activeTool.source, stage: 'done' }
            : (meta.tool ? { name: meta.tool.name, source: meta.tool.source, stage: 'done' } : null)
        });
        // 工具忙碌解除後就清掉 active tool（避免下一輪誤顯示）
        this._activeTool = null;
        this.openGate();  // 第二輪再正常輸出
      }
    };

    const handleTool = (msg, meta = {}) => {
      if (!this.processing) return;
      if (this._toolRoundCount >= MAX_TOOL_ROUNDS) {
        const err = new Error(`Max tool rounds exceeded (${MAX_TOOL_ROUNDS})`);
        this.logger.error(`[tool-limit] ${err.message}`);
        this._finalizeWithError(err, { reason: 'max_tool_rounds' });
        try { this.currentHandler?.stop(); } catch {}
        return;
      }
      if (toolTriggered) return; // 避免重複觸發相同工具
      toolTriggered = true;
      this._toolRoundCount += 1;
      this._waitingHold = false;     // 不再強制 waiting
      this.toolResultBuffer.push(msg);
      this._needCleanup = true;
      
      // ★ 記錄工具觸發來源與詳細資訊
      const source = meta.source || 'unknown';
      const detection = meta.detection || {};
      // ★ 保存當前工具資訊（供前端狀態顯示）
      if (!this._activeTool && this._toolBusy) {
        this._activeTool = {
          name: detection.toolName || msg?.toolName || 'unknown',
          source,
          detection
        };
      }
      this.logger.info(`[tool-triggered] 來源=${source}, 工具=${detection.toolName || 'unknown'}`);
      if (source === 'reasoning') {
        this.logger.info(`[tool-from-reasoning] 工具呼叫來自 reasoning_content，非使用者可見輸出`);
      }

      // 若 end 早一步來過 → 延後鎖已被設起，這裡直接開同一 phase 的第二輪
      if (this._endDeferred) {
        this._endDeferred = false;
        emitRoundEnd();
        this._processNext({ message: this.currentTask.message, _keepPhase: true });
        return;
      }
      // 否則主動結束本輪串流，加速進入 end → 由 end 啟第二輪
      postToolAbort = true;
      try { this.currentHandler?.stop(); } catch {}
    };

    const bindRouter = (r, { channel = 'talk', silentData = false } = {}) => {
      r.on('waiting', handleWaiting);
      r.on('data', chunk => {
        if (!chunk) return;
        if (silentData) return;

        if (channel === 'think') {
          reasoningBuf += chunk;
          this.logger.info(`[reasoning-chunk] 長度=${chunk.length}`);
          // ★ 新增：將 reasoning 視作思考，直接送給前端
          this.emit('stream', { channel: 'think', content: chunk, phaseId: this.phaseId });
          return;
        }

        // talk
        this.logger.info(`[content-chunk] 長度=${chunk.length}`);
        assistantBuf += chunk;
        this._pushChunk(chunk);
      });
      // ★ 恢復文字偵測工具呼叫（偽協議），傳遞來源資訊
      r.on('tool', (msg, meta) => handleTool(msg, meta));
    };

    bindRouter(router, { channel: 'talk', silentData: false });
    // ★ 修改：reasoning 也要輸出給前端（視為 think）
    bindRouter(reasoningRouter, { channel: 'think', silentData: false });

    handler.on('data', (chunk, raw, reasoning) => {
      if (chunk) router.feed(chunk);
      if (reasoning) reasoningRouter.feed(reasoning);
    });

    // ★ 已移除 handler.on('tool_calls', ...) 整段
    // 工具呼叫改用「偽協議」：由 ToolStreamRouter 偵測文字輸出中的 JSON
    // 偵測到 {toolName, input} 後，handleTool 會執行工具並啟動第二輪

    // ★ 已移除 response_done 事件監聽（改回 chat/completions，無此事件）

    handler.on('end', async () => {
      // ★ B 路線：end 時必須 force flush，避免未完結片段卡在 buffer
      // 仍維持 dropUnfinishedToolJson=true，避免把殘缺 JSON（工具呼叫殘片）輸出到前端。
      await Promise.all([
        router.flush({ force: true, dropUnfinishedToolJson: true }),
        reasoningRouter.flush({ force: true, dropUnfinishedToolJson: true })
      ]);
      // end-latch：若工具仍在忙（或結果尚未回來），延後收尾
      if (this._toolBusy) {
        this._endDeferred = true;
        this.logger.info('[完成-deferred] 工具執行中，延後收尾與下一輪啟動');
        return;
      }

      // ★ 傳遞 toolTriggered 讓監聽者知道是否還有後續回合
      if (toolTriggered) {
        emitRoundEnd();
        this.logger.info(`[round_end] phaseId=${this.phaseId} round=${this._phaseRound}`);
        this._processNext({ message: this.currentTask.message, _keepPhase: true });
        return;
      }

      this.emit('end', {
        phaseId: this.phaseId,
        round: this._phaseRound,
        toolTriggered: false,
        final: true
      });
      this.processing = false;
      this.logger.info('[完成] 對話回應完成');

      const text = assistantBuf.trim();
      // ★ 新增：記錄 assistantBuf 和 reasoningBuf 的狀態
      this.logger.info(`[完成-buffer] assistantBuf 長度=${assistantBuf.length}, reasoningBuf 長度=${reasoningBuf.length}, toolTriggered=${toolTriggered}`);
      if (text) {
        this.logger.info(`[完成-output] 準備輸出回應，長度=${text.length}`);
        // 回應成功時記錄至記憶與檔案
        const msg = { role:'assistant', content: text, talker:task.message.talker, timestamp:Date.now() };
        this.history.push(msg);
        this._pruneHistory();
        historyManager.appendMessage(task.message.talker, 'assistant', msg.content).catch(e => {
          this.logger.warn('[history] 紀錄回應失敗: ' + e.message);
        });
        this.emit('data', text);
      } else {
        this.logger.warn('[完成-warning] assistantBuf 為空，無內容可輸出');
      }
      this._cleanupToolBuffer();
      if (this.pendingQueue.length > 0) {
        const nextTask = this.pendingQueue.shift();
        this._processNext(nextTask);
      }
    });

    handler.on('error', err => {
      this.logger.error(`[串流錯誤] ${err?.message || err}`);
      this._finalizeWithError(err, { reason: 'stream_error' });
    });
    handler.on('abort', () => {
      this.emit('abort');
      if (postToolAbort) {
        postToolAbort = false;
        this.processing = false;
        emitRoundEnd();
        this.logger.info(`[round_end] phaseId=${this.phaseId} round=${this._phaseRound} (abort)`);
        this.logger.info('[中止] 工具結果到達，重新啟動回合');
        this._processNext({ message: this.currentTask.message, _keepPhase: true });
        return;
      }
      this._finalizeWithError(new Error('aborted'), { reason: 'aborted' });
    });

    // 確認插件服務狀態
    PM.getPluginState('llamaServer').then(state => {
      if (state !== 1) {
        const err = new Error('llamaServer 未啟動');
        this.logger.error('[錯誤] ' + err.message);
        handler.emit('error', err);
        return;
      }
      // 若是工具回注的下一輪，先退回 waiting:false（在首個 data 之前）
      if (task._keepPhase && this._waitingHold) {
        this._setWaiting(false, { reason: 'post_tool_round_start' });
        this._waitingHold = false;
      }
      // 讓 log 可讀：避免 [object Object]
      try { this.logger.info('composeMessages=' + JSON.stringify(messages)); } catch (err) { this.logger.error('[錯誤] composeMessages 序列化失敗: ' + err.message); }
      
      // ★ 組合請求選項（不送 tools/tool_choice，使用偽協議）
      // ★ 已移除 previous_response_id（改回 chat/completions）
      const startOptions = {};
      
      handler.start(messages, startOptions);  // 啟動串流
    }).catch(err => {
      this.logger.error('[錯誤] 讀取服務狀態失敗: ' + err.message);
      handler.emit('error', err);
    });
  }

  /*─── 其餘 API（與 Angel 寫法一致） ───────────────────*/
  getState()            { return this.processing ? 'processing' : 'idle'; }
  clearHistory()        { this.history = []; }
  abort(reason = 'aborted') { this.manualAbort(reason); }
  stop(reason = 'aborted') { this.manualAbort(reason); }
  manualAbort(reason = 'aborted') {
    if (this.processing && !this.currentTask?.uninterruptible) {
      this.logger.info('[手動中斷] 當前輸出被中止');
      this.currentHandler?.stop();
      this.gateBuffer = '';
      this._waitingHold = false;
      this._finalizeWithError(new Error(reason), { reason });
    } else {
      this.logger.info('[手動中斷失敗] 任務不可中斷');
    }
  }
  openGate()  { this.gateOpen = true;  this.logger.info('[gate 打開]');  if (this.gateBuffer) { this.emit('data', this.gateBuffer); this.gateBuffer=''; } }
  closeGate() { this.gateOpen = false; this.logger.info('[gate 關閉]'); }
  getGateState() { return this.gateOpen ? 'open' : 'close'; }
  getWaitingState() { return this.waitingForTool ? 'waiting' : 'idle'; }

  _setWaiting(state, extra = {}) {
    this.waitingForTool = state;
    this.emit('status', { waiting: state, phaseId: this.phaseId, ...extra });
  }

  _pushChunk(chunk) {
    // ★ 向前端提供可區分通道的串流事件（不影響既有 data 事件）
    this.emit('stream', { channel: 'talk', content: chunk, phaseId: this.phaseId });
    if (this.gateOpen) this.emit('data', chunk);
    else               this.gateBuffer += chunk;
  }

  _cleanupToolBuffer() {
    if (this._needCleanup) {
      this.toolResultBuffer = [];
      this._needCleanup = false;
    }
  }

  _finalizeWithError(err, { reason = 'error' } = {}) {
    if (!this.processing) return;
    this.processing = false;
    this.currentHandler = null;
    this.waitingForTool = false;
    this._toolBusy = false;
    this._endDeferred = false;
    this._waitingHold = false;
    this._activeTool = null;
    this._phaseRound = 0;
    this.gateBuffer = '';
    this._cleanupToolBuffer();
    this._setWaiting(false, { reason, state: 'thinking', usingTool: false });
    this.emit('error', err);
  }
}

// 匯出單例
module.exports = new TalkToDemonManager();
