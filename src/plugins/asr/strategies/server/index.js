const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

const logger = new Logger('ASRServer');
const priority = 80;

let registered = false;

module.exports = {
  priority,
  /** 啟動伺服器模式：註冊 ngrok 子網域並轉發指令至本地 ASR */
  async online(options = {}) {
    await local.online(options);

    const handler = async (req, res) => {
      const action = req.params.action;
      try {
        switch (action) {
          case info.routes.start:
            await local.online(options);
            return res.status(200).end();
          case info.routes.stop:
            await local.offline();
            return res.status(200).end();
          case info.routes.restart:
            await local.restart(options);
            return res.status(200).end();
          case info.routes.state: {
            const state = await local.state();
            return res.status(200).json({ state });
          }
          default:
            return res.status(404).end();
        }
      } catch (e) {
        logger.error('處理 ASR 遠端請求失敗: ' + e.message);
        return res.status(500).end();
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
  }
};
