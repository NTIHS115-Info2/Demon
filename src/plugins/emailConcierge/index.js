const Logger = require('../../utils/logger');
const GmailClient = require('./gmailClient');

const logger = new Logger('EmailConcierge');

module.exports = {
  name: 'EmailConcierge',
  client: null,

  async start(options = {}) {
    this.client = new GmailClient(options);
    await this.client.init();
    logger.info('Message ID: system | Status: Service Started');
  },

  async stop() {
    this.client = null;
    logger.info('Message ID: system | Status: Service Stopped');
  }
};
