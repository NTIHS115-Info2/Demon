const axios = require('axios');
const EventEmitter = require('events');
const Logger = require('../../../../utils/logger');
const info = require('./infor');

const logger = new Logger('LlamaRemote');

let baseUrl = '';

// 此策略的預設啟動優先度
const priority = 40;

module.exports = {
    priority,
  /**
   * 啟動遠端策略
   * @param {Object} options
   * @param {string} options.baseUrl 遠端伺服器位址，例如 https://xxxx.ngrok.io
   */
  async online(options = {}) {
    if (!options.baseUrl) {
      throw new Error('遠端模式需要提供 baseUrl');
    }
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`Llama remote 已設定 baseUrl: ${baseUrl}`);
    return true;
  },

  /** 停止遠端策略 */
  async offline() {
    baseUrl = '';
    logger.info('Llama remote 已關閉');
    return true;
  },

  /** 重新啟動遠端策略 */
  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  /** 檢查狀態：有 baseUrl 即視為上線 */
  async state() {
    return baseUrl ? 1 : 0;
  },

  /**
   * 透過 HTTP 與遠端伺服器互動
   * @param {Array} messages - 傳遞給 Llama 的訊息陣列
   * @returns {EventEmitter}
   */
  async send(messages = []) {
    if (!baseUrl) throw new Error('遠端未初始化');

    const emitter = new EventEmitter();
    let stream = null;

    const url = `${baseUrl}/${info.subdomain}/${info.routes.send}`;
    const payload = { messages, stream: true };

    axios({
      url,
      method: 'POST',
      data: payload,
      responseType: 'stream',
      headers: { 'Content-Type': 'application/json' }
    }).then(res => {
      stream = res.data;
      let buffer = '';
      stream.on('data', chunk => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const content = line.replace('data: ', '').trim();
            if (content === '[DONE]') {
              emitter.emit('end');
              return;
            }
            try {
              const json = JSON.parse(content);
              const text = json.text || json.choices?.[0]?.delta?.content || '';
              emitter.emit('data', text, json);
            } catch (e) {
              emitter.emit('error', e);
            }
          }
        }
      });
      stream.on('end', () => emitter.emit('end'));
      stream.on('error', err => emitter.emit('error', err));
    }).catch(err => emitter.emit('error', err));

    emitter.abort = () => {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
        emitter.emit('abort');
      }
    };

    return emitter;
  }
};
