const clientManager = require('./clientManager');
const messageHandler = require('./messageHandler');
const commandHandler = require('./commandHandler');
const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');
// 讀取共用設定檔，若不存在則拋出錯誤
let config;
try {
  config = require('../../configLoader');
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
    logger.info('[DISCORD] 開始重啟客戶端');
    try {
      const opts = { ...config, ...options };
      await this.offline();
      await clientManager.login(opts);
      messageHandler.attach(clientManager.getClient(), opts);
      commandHandler.setupDefaultCommands();
      commandHandler.handle(clientManager.getClient());
      await commandHandler.register(opts);
      logger.info('[DISCORD] 客戶端重啟完成');
    } catch (e) {
      // 避免記錄可能包含敏感資訊的完整錯誤
      const safeError = e.message?.includes('token') ? '重啟時憑證驗證失敗' : e.message;
      logger.error('[DISCORD] 客戶端重啟失敗: ' + safeError);
      throw e;
    }
  },

  async state() {
    return clientManager.getState();
  },

  async send(data) {
    const client = clientManager.getClient();
    if (!client) {
      logger.warn('[DISCORD] 客戶端未連線，無法發送訊息');
      return false;
    }
    
    // 驗證必要參數
    if (!data || !data.channelId || !data.message) {
      logger.error('[DISCORD] send 參數不完整，需要 channelId 和 message');
      return false;
    }
    
    try {
      const channel = await client.channels.fetch(data.channelId);
      if (!channel) {
        logger.error('[DISCORD] 找不到指定頻道');
        return false;
      }
      
      await channel.send(data.message);
      logger.info('[DISCORD] 訊息發送成功');
      return true;
    } catch (e) {
      // 避免記錄可能包含敏感資訊的完整錯誤
      const safeError = e.code ? `Discord API 錯誤 (${e.code})` : '發送訊息時發生未知錯誤';
      logger.error('[DISCORD] 發送訊息失敗: ' + safeError);
      return false;
    }
  }
};
