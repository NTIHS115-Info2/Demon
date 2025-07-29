const clientManager = require('./clientManager');
const messageHandler = require('./messageHandler');
const commandHandler = require('./commandHandler');
const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');
// 讀取共用設定檔，若不存在則拋出錯誤
let config;
try {
  config = require('../../config');
} catch (e) {
  logger.error('[DISCORD] 無法讀取設定檔: ' + e.message);
  throw e;
}

// 插件啟動優先度，數值越大越先啟動
const priority = 65;

module.exports = {
  priority,
  name: 'DISCORD',

  async online(options = {}) {
    const opts = { ...config, ...options };
    const client = await clientManager.login(opts);
    messageHandler.attach(client, opts);
    commandHandler.setupDefaultCommands();
    commandHandler.handle(client);
    await commandHandler.register(opts);
  },

  async offline() {
    await clientManager.logout();
  },

  async restart(options = {}) {
    const opts = { ...config, ...options };
    await this.offline();
    await clientManager.login(opts);
  },

  async state() {
    return clientManager.getState();
  },

  async send(data) {
    const client = clientManager.getClient();
    if (!client) return false;
    try {
      const channel = await client.channels.fetch(data.channelId);
      if (channel) await channel.send(data.message);
      return true;
    } catch (e) {
      const Logger = require('../../../../utils/logger');
      const logger = new Logger('DISCORD');
      logger.error('[DISCORD] 發送訊息失敗: ' + e);
      return false;
    }
  }
};
