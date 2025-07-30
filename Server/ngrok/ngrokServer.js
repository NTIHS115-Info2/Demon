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
    if (this.handlers.has(subdomain)) {
      log.warn(`子網域 ${subdomain} 已被註冊`);
      return false;
    }
    this.handlers.set(subdomain, handler);
    log.info(`註冊子網域 ${subdomain}`);
    return true;
  }

  /**
   * 解除子網域註冊
   * @param {string} subdomain
   * @returns {boolean}
   */
  unregisterSubdomain(subdomain) {
    if (!this.handlers.has(subdomain)) {
      log.warn(`欲解除的子網域 ${subdomain} 不存在`);
      return false;
    }
    this.handlers.delete(subdomain);
    log.info(`已解除子網域 ${subdomain}`);
    return true;
  }

  /**
   * 啟動 ngrok 與 Express 伺服器
   * @param {object} options
   * @returns {Promise<string>} 公開網址
   */
  async start(options = {}) {
    if (this.running) {
      log.warn('ngrok 已在運行中');
      return this.publicUrl;
    }
    const port = options.port || this.port;

    // 啟動 Express 伺服器
    this.app = express();
    this.app.use(express.json());
    this.app.all('/:subdomain/*', (req, res) => {
      const { subdomain } = req.params;
      const handler = this.handlers.get(subdomain);
      if (!handler) {
        res.status(404).send('not found');
        return;
      }
      try {
        Promise.resolve(handler(req, res)).catch(err => {
          log.error(`處理 ${subdomain} 時發生錯誤: ${err.message}`);
          res.status(500).send('error');
        });
      } catch (err) {
        log.error(`處理 ${subdomain} 例外: ${err.message}`);
        res.status(500).send('error');
      }
    });

    await new Promise((resolve, reject) => {
      this.server = this.app.listen(port, err => {
        if (err) {
          log.error(`Express 啟動失敗: ${err.message}`);
          reject(err);
        } else {
          log.info(`Express 已啟動於 ${port}`);
          resolve();
        }
      });
    });

    // 啟動 ngrok
    const args = this.buildArgs(port);
    try {
      this.process = spawn(this.binPath, args, { windowsHide: true });
    } catch (err) {
      log.error(`無法啟動 ngrok: ${err.message}`);
      throw err;
    }

    return new Promise((resolve, reject) => {
      const onStdout = data => {
        const msg = data.toString();
        log.info(`[ngrok] ${msg.trim()}`);
        const match = msg.match(/url=(https?:\/\/[^\s]+)/);
        if (match && !this.publicUrl) {
          this.publicUrl = match[1];
          this.running = true;
          log.info(`✅ ngrok 已就緒：${this.publicUrl}`);
          resolve(this.publicUrl);
        }
      };

      this.process.stdout.on('data', onStdout);
      this.process.stderr.on('data', d => log.error(`[ngrok] ${d.toString().trim()}`));

      this.process.on('exit', code => {
        this.running = false;
        this.publicUrl = null;
        log.info(`ngrok 已退出，代碼 ${code}`);
      });

      this.process.on('error', err => {
        log.error(`ngrok 執行錯誤: ${err.message}`);
        reject(err);
      });
    });
  }

  /** 停止所有服務 */
  async stop() {
    if (this.server) {
      await new Promise(res => this.server.close(() => res()));
      this.server = null;
      this.app = null;
      log.info('Express 已停止');
    }

    if (this.process && this.running) {
      log.info('正在關閉 ngrok...');
      return new Promise(resolve => {
        this.process.once('exit', code => {
          this.running = false;
          this.publicUrl = null;
          log.info(`ngrok 已關閉，代碼 ${code}`);
          resolve(true);
        });
        this.process.kill();
      });
    }
    log.warn('ngrok 尚未啟動');
    return false;
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
