const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

const logger = new Logger('LlamaServer');
const priority = 50;

let registered = false;

module.exports = {
  priority,
  /**
   * 啟動伺服器模式：啟動本地 Llama 並註冊 ngrok 子網域
   */
  async online(options = {}) {
    await local.online(options);

    const handler = async (req, res) => {
      if (req.method === 'POST' && req.params.action === info.routes.send) {
        try {
          const msgs = Array.isArray(req.body.messages) ? req.body.messages : [];
          const emitter = await local.send(msgs);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          });
          emitter.on('data', txt => res.write(`data: ${JSON.stringify({ text: txt })}\n`));
          emitter.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
          emitter.on('error', err => { logger.error(err.message); res.status(500).end(); });
        } catch (e) {
          logger.error(`處理遠端請求失敗: ${e.message}`);
          res.status(500).end();
        }
      } else {
        res.status(404).end();
      }
    };

    const result = await pluginsManager.send('ngrok', { action: 'register', subdomain: info.subdomain, handler });
    if (!result) {
      logger.error('註冊 ngrok 子網域失敗');
      return false;
    }
    registered = true;
    return true;
  },

  /** 關閉伺服器並解除註冊 */
  async offline() {
    if (registered) {
      await pluginsManager.send('ngrok', { action: 'unregister', subdomain: info.subdomain });
      registered = false;
    }
    await local.offline();
    return true;
  },

  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  async state() {
    return local.state();
  },

  send: local.send
};
