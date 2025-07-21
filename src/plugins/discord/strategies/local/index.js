const clientManager = require('./clientManager');
const messageHandler = require('./messageHandler');
const commandHandler = require('./commandHandler');

// 插件啟動優先度，數值越大越先啟動
const priority = 65;

module.exports = {
  priority,
  name: 'DISCORD',

  async online(options = {}) {
    const client = await clientManager.login(options);
    messageHandler.attach(client, options);
    commandHandler.setupDefaultCommands();
    commandHandler.handle(client);
    await commandHandler.register({
      applicationId: options.applicationId,
      guildId: options.guildId,
      token: options.token
    });
  },

  async offline() {
    await clientManager.logout();
  },

  async restart(options = {}) {
    await this.offline();
    await clientManager.login(options);
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
