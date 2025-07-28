// TalkToDemonManager.js
// ──────────────────────────────────────────────────────────────
// 封裝對 llamaServer 的對話管理、串流控制、中斷與優先佇列
const { EventEmitter }          = require('events');
const PM                        = require('./pluginsManager.js');
const Logger                    = require('../utils/logger.js');
const { composeMessages } = require('./PromptComposer.js');
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
    const userMsg = { role:'user', content:`${talker}： ${content}`, timestamp:Date.now() };

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
    this.currentTask  = task;

    const messages = await composeMessages(this.history, this.toolResultBuffer);

    const handler = new LlamaStreamHandler(this.model);
    this.currentHandler = handler;
    const router = new toolOutputRouter.ToolStreamRouter();
    router.on('waiting', s => this._setWaiting(s));
    let assistantBuf = '';
    let toolTriggered = false;

    router.on('data', chunk => {
      assistantBuf += chunk;
      this._pushChunk(chunk);
    });

    router.on('tool', msg => {
      toolTriggered = true;
      this.toolResultBuffer.push(msg);
      this._needCleanup = true;
    });

    handler.on('data', chunk => {
      if (!toolTriggered) router.feed(chunk);
    });

    handler.on('end', async () => {
      router.flush();
      this.emit('end');
      this.processing = false;
      this.logger.info('[完成] 對話回應完成');

      if (toolTriggered) {
        this._processNext({ message: this.currentTask.message });
        return;
      }

      const text = assistantBuf.trim();
      if (text) {
        this.history.push({ role:'assistant', content: text, timestamp:Date.now() });
        this._pruneHistory();
        this.emit('data', text);
      }
      if (!toolTriggered) this._cleanupToolBuffer();
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
    } else {
      this.logger.info('[手動中斷失敗] 任務不可中斷');
    }
  }
  openGate()  { this.gateOpen = true;  this.logger.info('[gate 打開]');  if (this.gateBuffer) { this.emit('data', this.gateBuffer); this.gateBuffer=''; } }
  closeGate() { this.gateOpen = false; this.logger.info('[gate 關閉]'); }
  getGateState() { return this.gateOpen ? 'open' : 'close'; }
  getWaitingState() { return this.waitingForTool ? 'waiting' : 'idle'; }

  _setWaiting(state) {
    this.waitingForTool = state;
    if (state) this.emit('data', '我正在查詢，請稍等我一下～');
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
