const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

// 伺服器模式 logger，對外名稱統一為 ttsEngine
const logger = new Logger('ttsEngineServer');
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
            logger.warn('ttsEngine 遠端請求收到空白文字');
            return res.status(400).json({ error: 'Empty text provided' });
          }
          // 透過本地策略取得可讀 stream，並以串流方式回傳 PCM
          const session = await local.send(text);
          const metadata = await session.metadataPromise;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('X-Audio-Format', metadata.format);
          res.setHeader('X-Audio-Sample-Rate', String(metadata.sample_rate));
          res.setHeader('X-Audio-Channels', String(metadata.channels));

          session.stream.on('error', (err) => {
            logger.error('ttsEngine 串流輸出失敗: ' + err.message);
            if (!res.headersSent) {
              res.status(500).json({ error: 'ttsEngine streaming failed', details: err.message });
            } else {
              logger.error('ttsEngine 串流在回應已開始後發生錯誤，連線將被中斷，可能已送出部分音訊資料');
              if (typeof res.destroy === 'function') {
                res.destroy(err);
              } else {
                res.end();
              }
            }
          });

          session.stream.pipe(res);
          return;
        } catch (e) {
          logger.error('處理 ttsEngine 遠端請求失敗: ' + e.message);
          return res.status(500).json({ error: 'ttsEngine processing failed', details: e.message });
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
