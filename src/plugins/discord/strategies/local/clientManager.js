const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');

// 必須存在的設定檔，讀取失敗時拋出錯誤
let config;
try {
  config = require('../../configLoader');
} catch (e) {
  logger.error('[DISCORD] 無法讀取設定檔: ' + e.message);
  throw e;
}

let client = null;

module.exports = {
  /**
   * 建立並登入 Discord Client
   * @param {object} options - 登入選項 { token, intents }
   */
  async login(options = {}) {
    if (client) {
      logger.warn('[DISCORD] 客戶端已存在，略過重新登入');
      return client;
    }
    try {
      client = new Client({
        intents: options.intents || [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
      });
      const token = options.token || config.token;
      await client.login(token);
      logger.info('[DISCORD] 客戶端登入成功');
      return client;
    } catch (e) {
      logger.error('[DISCORD] 客戶端登入失敗: ' + e);
      client = null;
      throw e;
    }
  },

  /**
   * 登出並銷毀 Client
   */
  async logout() {
    if (!client) {
      logger.warn('[DISCORD] 客戶端尚未啟動');
      return;
    }
    try {
      await client.destroy();
      logger.info('[DISCORD] 客戶端已登出');
    } catch (e) {
      logger.error('[DISCORD] 登出錯誤: ' + e);
      throw e;
    } finally {
      client = null;
    }
  },

  getClient() {
    return client;
  },

  getState() {
    return client ? 1 : 0;
  }
};
