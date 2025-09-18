// TalkToDemonManager.js
// ──────────────────────────────────────────────────────────────
// 封裝對 llamaServer 的對話管理、串流控制、中斷與優先佇列
const { EventEmitter }          = require('events');
const { composeMessages }       = require('./PromptComposer.js');
const PM                        = require('./pluginsManager.js');
const Logger                    = require('../utils/logger.js');
const historyManager            = require('./historyManager');
const toolOutputRouter          = require('./toolOutputRouter');

// 參數
const MAX_HISTORY     = 50;
const EXPIRY_TIME_MS  = 10 * 60 * 1000; // 10 分鐘

// ────────────────── 1. 串流處理器 ────────────────────────────
class LlamaStreamHandler extends EventEmitter {
  constructor() {
    super();
    this.llamaEmitter = null;   // PM.send 回傳的 EventEmitter
    this.stopped      = false;
    this.logger       = new Logger('LlamaStream.log');
  }

  /**
   * 啟動串流
   * @param {Array<{role:string,content:string}>} messages
   */
  async start(messages) {
    this.stopped = false;

    try {

      this.logger.info('[串流開始] 正在向 llamaServer 發送請求...');
      this.logger.info(`請求內容：`);
      this.logger.info(messages);

      const emitter = await PM.send('llamaServer', messages);          // ★向插件請求串流資料

      this.logger.Original(emitter);

      if (!emitter || !(emitter instanceof EventEmitter)) {
        throw new Error('llamaServer 未回傳有效 EventEmitter');
      }

      this.llamaEmitter = emitter;

      emitter.on('data', chunk => {
        if (this.stopped) return;
        const text = typeof chunk === 'string' ? chunk : String(chunk);
        this.emit('data', text);
        this.logger.info(`[Llama] 回應: ${text}`);
      });

      emitter.on('end', () => {
        if (!this.stopped) {
          this.stopped = true;
          this.emit('end');
        }
      });

      emitter.on('error', err => {
        if (!this.stopped) {
          this.emit('error', err);
        }
      });

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
      } else {
        // 不支援 abort() 時，採取溫和 fallback
        this.llamaEmitter.removeAllListeners();
      }
    }

    this.emit('abort');
  }
}


// ────────────────── 2. 對話管理器 ───────────────────────────
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
    this._waitingHold  = false; // 鎖住 waiting=true 直到該輪 end
    this._toolBusy     = false; // 工具執行中（由 Router waiting 事件驅動）
    this._endDeferred  = false; // end-latch：忙碌時先到的 end 會延後處理
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
    if (!task._keepPhase) this.phaseId++;
    this.currentTask  = task;

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

    // composeMessages 可能因參數錯誤拋出例外，須捕捉以免整個流程中斷
    let messages;
    try {
      messages = await composeMessages(this.history, this.toolResultBuffer);
    } catch (err) {
      this.logger.error('[錯誤] 組合訊息失敗: ' + err.message);
      this.emit('error', err);
      this.processing = false;
      return;
    }

    const handler = new LlamaStreamHandler(this.model);
    this.currentHandler = handler;
    const router = new toolOutputRouter.ToolStreamRouter();
    // waiting:true/false 由 Router 發出，對應 工具開始/結束
    router.on('waiting', s => {
      this._toolBusy = !!s;
      if (s) {
        this._setWaiting(true, { reason: 'tool_busy' });
        this.closeGate(); // 擋住第一輪「請等一下」之類的雜訊
      } else {
        this._setWaiting(false, { reason: 'tool_idle' });
        this.openGate();  // 第二輪再正常輸出
      }
    });
    let assistantBuf = '';
    let toolTriggered = false;

    // 收到一般串流資料時直接輸出，同時累積至回應緩衝
    router.on('data', chunk => {
      assistantBuf += chunk;
      this._pushChunk(chunk);
    });

    // 工具已完成：msg 即工具回傳資料（Router 已保證）
    router.on('tool', msg => {
      toolTriggered = true;
      this._waitingHold = false;     // 不再強制 waiting
      this.toolResultBuffer.push(msg);
      this._needCleanup = true;

      // 若 end 早一步來過 → 延後鎖已被設起，這裡直接開同一 phase 的第二輪
      if (this._endDeferred) {
        this._endDeferred = false;
        this._processNext({ message: this.currentTask.message, _keepPhase: true });
        return;
      }
      // 否則主動結束本輪串流，加速進入 end → 由 end 啟第二輪
      try { this.currentHandler?.stop(); } catch {}
    });

    handler.on('data', chunk => {
      router.feed(chunk);
    });

    handler.on('end', async () => {
      router.flush();
      // end-latch：若工具仍在忙（或結果尚未回來），延後收尾
      if (this._toolBusy) {
        this._endDeferred = true;
        this.logger.info('[完成-deferred] 工具執行中，延後收尾與下一輪啟動');
        return;
      }

      this.emit('end');
      this.processing = false;
      this.logger.info('[完成] 對話回應完成');

      const text = assistantBuf.trim();
      if (text) {
        // 回應成功時記錄至記憶與檔案
        const msg = { role:'assistant', content: text, talker:task.message.talker, timestamp:Date.now() };
        this.history.push(msg);
        this._pruneHistory();
        historyManager.appendMessage(task.message.talker, 'assistant', msg.content).catch(e => {
          this.logger.warn('[history] 紀錄回應失敗: ' + e.message);
        });
        this.emit('data', text);
      }
      if (!toolTriggered) this._cleanupToolBuffer();
      // 工具已完成且本輪自然 end（或被 stop 觸發 end）→ 啟動同一 phase 的第二輪
      if (toolTriggered) {
        this._processNext({ message: this.currentTask.message, _keepPhase: true });
        return;
      }
      if (this.pendingQueue.length > 0) {
        const nextTask = this.pendingQueue.shift();
        this._processNext(nextTask);
      }
    });

    handler.on('error',  err => this.emit('error', err));
    handler.on('abort', () => this.emit('abort'));

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
      handler.start(messages);  // 啟動串流
    }).catch(err => {
      this.logger.error('[錯誤] 讀取服務狀態失敗: ' + err.message);
      handler.emit('error', err);
    });
  }

  /*─── 其餘 API（與 Angel 寫法一致） ───────────────────*/
  getState()            { return this.processing ? 'processing' : 'idle'; }
  clearHistory()        { this.history = []; }
  manualAbort() {
    if (this.processing && !this.currentTask?.uninterruptible) {
      this.logger.info('[手動中斷] 當前輸出被中止');
      this.currentHandler?.stop();
      this.gateBuffer = '';
      this._waitingHold = false;
      this._setWaiting(false, { reason: 'aborted' });
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
    if (this.gateOpen) this.emit('data', chunk);
    else               this.gateBuffer += chunk;
  }

  _cleanupToolBuffer() {
    if (this._needCleanup) {
      this.toolResultBuffer = [];
      this._needCleanup = false;
    }
  }
}

// 匯出單例
module.exports = new TalkToDemonManager();
