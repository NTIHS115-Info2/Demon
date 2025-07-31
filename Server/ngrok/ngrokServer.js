const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const express = require('express');
const Logger = require('../../src/utils/logger.js');
const configManager = require('../../src/utils/configManager');

const log = new Logger('ngrok-server.log');

// Ngrok 設定檔驗證綱要
const NGROK_CONFIG_SCHEMA = {
  types: {
    binPath: 'string',
    port: 'number',
    command: 'string',
    authtoken: 'string'
  },
  ranges: {
    port: { min: 1000, max: 65535 }
  },
  filePaths: ['binPath'] // 需要驗證存在的檔案路徑
};

class NgrokServerManager {
  constructor(options = {}) {
    // 載入設定檔（如果存在）
    const config = this.loadConfig();
    
    // 合併設定檔和傳入參數
    const mergedOptions = { ...config, ...options };
    
    // ngrok 執行檔路徑，預設為與本檔案同目錄的 ngrok.exe
    this.binPath = mergedOptions.binPath || path.resolve(__dirname, 'ngrok.exe');
    // 本地監聽埠號
    this.port = mergedOptions.port || 3000;
    // 可自訂執行指令，例如 http、tcp 等
    this.command = mergedOptions.command || 'http';
    // Ngrok authtoken（選填）
    this.authtoken = mergedOptions.authtoken;
    // 其他額外參數
    this.extraArgs = mergedOptions.extraArgs || [];

    this.process = null;      // ngrok 子程序
    this.running = false;     // ngrok 是否運行中
    this.publicUrl = null;    // 取得的公開網址

    this.app = null;          // express 實例
    this.server = null;       // HTTP server
    this.handlers = new Map();// 子網域對應表
    
    // 驗證 ngrok 執行檔
    this.validateBinaryPath();
  }

  /**
   * 載入 ngrok 設定檔
   * @private
   */
  loadConfig() {
    try {
      const configPath = path.resolve(__dirname, '..', '..', 'config', 'ngrok.js');
      if (fs.existsSync(configPath)) {
        return configManager.loadAndValidate(configPath, NGROK_CONFIG_SCHEMA, 'Ngrok');
      }
    } catch (error) {
      log.warn(`無法載入 Ngrok 設定檔，使用預設值: ${error.message}`);
      // 創建範例設定檔
      this.createExampleConfig();
    }
    return {};
  }

  /**
   * 創建 Ngrok 範例設定檔
   * @private
   */
  createExampleConfig() {
    try {
      const configDir = path.resolve(__dirname, '..', '..', 'config');
      const examplePath = path.join(configDir, 'ngrok.example.js');
      
      const exampleConfig = {
        binPath: "請填入ngrok.exe的完整路徑",
        port: 3000,
        command: "http",
        authtoken: "請填入您的ngrok authtoken（選填）",
        extraArgs: []
      };
      
      if (!fs.existsSync(examplePath)) {
        configManager.createExampleConfig(examplePath, exampleConfig, 'Ngrok');
      }
    } catch (error) {
      log.error(`創建 Ngrok 範例設定檔失敗: ${error.message}`);
    }
  }

  /**
   * 驗證 ngrok 執行檔是否存在
   * @private
   */
  validateBinaryPath() {
    if (!fs.existsSync(this.binPath)) {
      const error = new Error(`Ngrok 執行檔不存在: ${this.binPath}\n請下載 ngrok.exe 並確認路徑正確。`);
      log.error(error.message);
      throw error;
    }
    log.info(`Ngrok 執行檔驗證成功: ${this.binPath}`);
  }

  /**
   * 建立 ngrok 參數陣列
   */
  buildArgs(port) {
    const args = [this.command, String(port)];
    
    // 如果有 authtoken，添加到參數中
    if (this.authtoken && this.authtoken !== "請填入您的ngrok authtoken（選填）") {
      args.push('--authtoken', this.authtoken);
    }
    
    // 添加額外參數
    args.push(...this.extraArgs, '--log=stdout');
    
    return args;
  }

  /**
   * 註冊子網域處理函式
   * @param {string} subdomain 子網域名稱
   * @param {function} handler 處理函式 (req, res) => {}
   */
  registerSubdomain(subdomain, handler) {
    // 加強參數驗證
    if (!subdomain || typeof subdomain !== 'string') {
      log.error('註冊子網域失敗：子網域名稱無效');
      return false;
    }
    if (!handler || typeof handler !== 'function') {
      log.error('註冊子網域失敗：處理函式無效');
      return false;
    }

    if (this.handlers.has(subdomain)) {
      log.warn(`重複註冊警告：子網域 ${subdomain} 已被註冊，忽略新的註冊請求`);
      return false;
    }
    this.handlers.set(subdomain, handler);
    log.info(`成功註冊子網域 ${subdomain}`);
    return true;
  }

  /**
   * 解除子網域註冊
   * @param {string} subdomain
   * @returns {boolean}
   */
  unregisterSubdomain(subdomain) {
    // 加強參數驗證
    if (!subdomain || typeof subdomain !== 'string') {
      log.error('解除子網域失敗：子網域名稱無效');
      return false;
    }

    if (!this.handlers.has(subdomain)) {
      log.warn(`重複解除警告：欲解除的子網域 ${subdomain} 不存在，忽略解除請求`);
      return false;
    }
    this.handlers.delete(subdomain);
    log.info(`成功解除子網域 ${subdomain}`);
    return true;
  }

  /**
   * 啟動 ngrok 與 Express 伺服器
   * @param {object} options
   * @returns {Promise<string>} 公開網址
   */
  async start(options = {}) {
    if (this.running) {
      log.warn('ngrok 啟動被忽略：已在運行中');
      return this.publicUrl;
    }
    const port = options.port || this.port;
    log.info(`開始啟動 ngrok 服務，目標埠號：${port}`);

    try {
      // 啟動 Express 伺服器
      this.app = express();
      this.app.use(express.json());
      this.app.all('/:subdomain/*', (req, res) => {
        const { subdomain } = req.params;
        const handler = this.handlers.get(subdomain);
        if (!handler) {
          log.warn(`找不到子網域 ${subdomain} 的處理器`);
          res.status(404).send('not found');
          return;
        }
        try {
          Promise.resolve(handler(req, res)).catch(err => {
            log.error(`處理 ${subdomain} 時發生錯誤: ${err.message}`);
            if (!res.headersSent) {
              res.status(500).send('error');
            }
          });
        } catch (err) {
          log.error(`處理 ${subdomain} 例外: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).send('error');
          }
        }
      });

      await new Promise((resolve, reject) => {
        this.server = this.app.listen(port, err => {
          if (err) {
            log.error(`Express 伺服器啟動失敗：${err.message}`);
            log.error(`啟動失敗原因可能包括：埠號 ${port} 被佔用、權限不足、或系統資源不足`);
            reject(new Error(`Express 啟動失敗: ${err.message}`));
          } else {
            log.info(`Express 伺服器成功啟動於埠號 ${port}`);
            resolve();
          }
        });
      });
    } catch (err) {
      log.error(`Express 伺服器設置過程發生錯誤：${err.message}`);
      throw new Error(`Express 設置失敗: ${err.message}`);
    }

    // 啟動 ngrok
    const args = this.buildArgs(port);
    log.info(`準備啟動 ngrok，執行路徑：${this.binPath}，參數：${args.join(' ')}`);
    
    try {
      this.process = spawn(this.binPath, args, { windowsHide: true });
    } catch (err) {
      log.error(`ngrok 程序啟動失敗：${err.message}`);
      log.error(`啟動失敗原因可能包括：ngrok 執行檔不存在、執行檔損壞、權限不足、或系統不支援`);
      log.error(`請檢查 ngrok 執行檔路徑：${this.binPath}`);
      throw new Error(`ngrok 啟動失敗: ${err.message}`);
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      let timeoutId;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      // 設置超時處理
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          log.error('ngrok 啟動逾時：超過 30 秒未獲得公開網址');
          log.error('可能原因：網路連線問題、ngrok 服務異常、或認證失敗');
          reject(new Error('ngrok 啟動逾時'));
        }
      }, 30000);

      const onStdout = data => {
        const msg = data.toString();
        log.info(`[ngrok] ${msg.trim()}`);
        const match = msg.match(/url=(https?:\/\/[^\s]+)/);
        if (match && !this.publicUrl && !resolved) {
          resolved = true;
          cleanup();
          this.publicUrl = match[1];
          this.running = true;
          log.info(`✅ ngrok 成功啟動並建立公開網址：${this.publicUrl}`);
          resolve(this.publicUrl);
        }
      };

      this.process.stdout.on('data', onStdout);
      this.process.stderr.on('data', d => {
        const errorMsg = d.toString().trim();
        log.error(`[ngrok stderr] ${errorMsg}`);
        
        // 檢查常見錯誤模式
        if (errorMsg.includes('authentication failed')) {
          log.error('ngrok 認證失敗：請檢查 authtoken 設定');
        } else if (errorMsg.includes('tunnel session failed')) {
          log.error('ngrok 隧道連線失敗：請檢查網路連線');
        } else if (errorMsg.includes('account limit exceeded')) {
          log.error('ngrok 帳戶額度超限：請升級帳戶或等待重置');
        }
      });

      this.process.on('exit', code => {
        this.running = false;
        this.publicUrl = null;
        if (!resolved) {
          resolved = true;
          cleanup();
          log.error(`ngrok 程序意外退出，退出碼：${code}`);
          if (code !== 0) {
            log.error('ngrok 非正常退出，可能原因：設定錯誤、網路問題、或權限不足');
          }
          reject(new Error(`ngrok 程序退出，代碼：${code}`));
        } else {
          log.info(`ngrok 程序正常退出，代碼：${code}`);
        }
      });

      this.process.on('error', err => {
        if (!resolved) {
          resolved = true;
          cleanup();
          log.error(`ngrok 程序執行錯誤：${err.message}`);
          log.error('錯誤原因可能包括：執行檔權限不足、系統資源不足、或相依程式庫缺失');
          reject(new Error(`ngrok 執行錯誤: ${err.message}`));
        }
      });
    });
  }

  /** 停止所有服務 */
  async stop() {
    log.info('開始停止 ngrok 服務...');
    let stopped = false;

    // 停止 Express 伺服器
    if (this.server) {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Express 關閉逾時'));
          }, 5000);

          this.server.close((err) => {
            clearTimeout(timeout);
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        this.server = null;
        this.app = null;
        log.info('Express 伺服器已成功停止');
      } catch (err) {
        log.error(`Express 伺服器停止時發生錯誤：${err.message}`);
      }
    }

    // 停止 ngrok 程序
    if (this.process && this.running) {
      log.info('正在關閉 ngrok 程序...');
      try {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            log.warn('ngrok 程序未在預期時間內關閉，強制終止');
            if (this.process) {
              this.process.kill('SIGKILL');
            }
            this.running = false;
            this.publicUrl = null;
            resolve(true);
          }, 10000);

          this.process.once('exit', code => {
            clearTimeout(timeout);
            this.running = false;
            this.publicUrl = null;
            log.info(`ngrok 程序已成功關閉，退出碼：${code}`);
            stopped = true;
            resolve(true);
          });

          this.process.kill();
        });
      } catch (err) {
        log.error(`關閉 ngrok 程序時發生錯誤：${err.message}`);
        this.running = false;
        this.publicUrl = null;
      }
    }
    
    if (!stopped) {
      log.warn('ngrok 程序未在運行或已停止');
      return false;
    }
    return true;
  }

  /** 重新啟動 */
  async restart(options) {
    await this.stop();
    await new Promise(r => setTimeout(r, 500));
    return this.start(options);
  }

  /** 是否運行中 */
  isRunning() {
    return this.running;
  }

  /** 取得公開網址 */
  getUrl() {
    return this.publicUrl;
  }
}

module.exports = NgrokServerManager;
