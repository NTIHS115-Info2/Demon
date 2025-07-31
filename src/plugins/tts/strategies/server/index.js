const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

const logger = new Logger('TTSServer');
const priority = 80;

let registered = false;

module.exports = {
  priority,
  /** 啟動伺服器模式並註冊子網域 */
  async online(options = {}) {
    await local.online(options);

    const handler = async (req, res) => {
      if (req.method === 'POST' && req.params.action === info.routes.send) {
        try {
          const text = String(req.body.text || '');
          if (!text.trim()) {
            logger.warn('TTS 遠端請求收到空白文字');
            return res.status(400).json({ error: 'Empty text provided' });
          }
          await local.send(text);
          return res.status(200).json({ success: true, message: 'TTS processed successfully' });
        } catch (e) {
          logger.error('處理 TTS 遠端請求失敗: ' + e.message);
          return res.status(500).json({ error: 'TTS processing failed', details: e.message });
        }
      }
      return res.status(404).json({ error: 'Not found' });
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
