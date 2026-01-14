const local = require('../local');
const info = require('./infor');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

const logger = new Logger('ASRServer');

let registered = false;

module.exports = {
  /** 啟動伺服器模式：註冊 ngrok 子網域並轉發指令至本地 ASR */
  async online(options = {}) {
    await local.online(options);

    const handler = async (req, res) => {
      const action = req.params.action;
      const startTime = Date.now();
      
      // 設定請求逾時處理
      const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
          logger.error(`ASR ${action} 請求逾時 (超過 30 秒)`);
          res.status(500).json({ 
            error: '請求逾時',
            message: `ASR ${action} 操作超過 30 秒未完成`
          });
        }
      }, 30000);

      try {
        logger.info(`[ASRServer] 收到 ${action} 請求`);
        
        switch (action) {
          case info.routes.start: {
            await local.online(options);
            const duration = Date.now() - startTime;
            logger.info(`[ASRServer] ${action} 執行成功 (耗時 ${duration}ms)`);
            clearTimeout(timeoutId);
            return res.status(200).json({ 
              success: true, 
              message: 'ASR 已啟動',
              duration_ms: duration
            });
          }
          case info.routes.stop: {
            await local.offline();
            const duration = Date.now() - startTime;
            logger.info(`[ASRServer] ${action} 執行成功 (耗時 ${duration}ms)`);
            clearTimeout(timeoutId);
            return res.status(200).json({ 
              success: true, 
              message: 'ASR 已停止',
              duration_ms: duration
            });
          }
          case info.routes.restart: {
            await local.restart(options);
            const duration = Date.now() - startTime;
            logger.info(`[ASRServer] ${action} 執行成功 (耗時 ${duration}ms)`);
            clearTimeout(timeoutId);
            return res.status(200).json({ 
              success: true, 
              message: 'ASR 已重啟',
              duration_ms: duration
            });
          }
          case info.routes.state: {
            const state = await local.state();
            const duration = Date.now() - startTime;
            logger.info(`[ASRServer] ${action} 執行成功 (耗時 ${duration}ms)`);
            clearTimeout(timeoutId);
            return res.status(200).json({ 
              state, 
              duration_ms: duration,
              timestamp: new Date().toISOString()
            });
          }
          default: {
            clearTimeout(timeoutId);
            logger.warn(`[ASRServer] 未知的操作: ${action}`);
            return res.status(404).json({ 
              error: '未找到操作',
              message: `未知的 ASR 操作：${action}`,
              available_actions: Object.values(info.routes)
            });
          }
        }
      } catch (e) {
        const duration = Date.now() - startTime;
        clearTimeout(timeoutId);
        
        // 根據錯誤類型提供不同的錯誤回應
        let statusCode = 500;
        let errorMessage = e.message || '未知錯誤';
        let errorType = 'internal_error';
        
        if (e.message.includes('ECONNREFUSED')) {
          errorType = 'connection_error';
          errorMessage = '無法連接到本地 ASR 服務';
        } else if (e.message.includes('timeout') || e.message.includes('逾時')) {
          errorType = 'timeout_error';
          errorMessage = '操作逾時';
          statusCode = 408;
        } else if (e.message.includes('not found') || e.message.includes('找不到')) {
          errorType = 'not_found_error';
          errorMessage = '找不到指定的資源';
          statusCode = 404;
        }

        logger.error(`[ASRServer] 處理 ${action} 請求失敗 (${errorType}): ${errorMessage} (耗時 ${duration}ms)`);
        
        if (!res.headersSent) {
          return res.status(statusCode).json({
            error: errorType,
            message: errorMessage,
            action: action,
            duration_ms: duration,
            timestamp: new Date().toISOString()
          });
        }
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
