const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

const logger = new Logger('TTSServer');
let registered = false;

module.exports = {
  /** 啟動伺服器模式並註冊子網域 */
  async online(options = {}) {
    await local.online(options);

    const handler = async (req, res) => {
      if (req.method === 'POST' && req.params.action === info.routes.send) {
        try {
          const text = String(req.body.text || '');
          await local.send(text);
          return res.status(200).end();
        } catch (e) {
          logger.error('處理 TTS 遠端請求失敗: ' + e.message);
          return res.status(500).end();
        }
      }
      return res.status(404).end();
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
