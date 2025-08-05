const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('../../src/utils/logger.js');
const { validateLlamaConfig, validateAllLlamaConfigs, createLlamaExamples } = require('./configValidator');

const log = new Logger('llama-server.log');

class LlamaServerManager {
  constructor(options = {}) {
    // 以相對路徑設定執行檔與設定目錄，避免依賴絕對路徑
    this.binPath = options.binPath || path.join('Server', 'llama', 'llama_cpp_bin', 'llama-server.exe');
    this.settingsDir = options.settingsDir || path.join('Server', 'llama', 'settings');
    this.process = null;
    this.running = false;
    this.currentPreset = '';
    
    // 驗證執行檔是否存在
    this.validateBinaryPath();
    
    // 驗證設定檔目錄並創建範例
    this.initializeSettings();
  }

  /**
   * 驗證 llama-server 執行檔是否存在
   * @private
   */
  validateBinaryPath() {
    if (!fs.existsSync(this.binPath)) {
      const error = new Error(`Llama server 執行檔不存在: ${this.binPath}\n請確認檔案路徑正確或下載對應的執行檔。`);
      log.error(error.message);
      throw error;
    }
    log.info(`Llama server 執行檔驗證成功: ${this.binPath}`);
  }

  /**
   * 初始化設定檔目錄
   * @private
   */
  initializeSettings() {
    try {
      // 驗證所有現有設定檔
      const validation = validateAllLlamaConfigs(this.settingsDir);
      
      if (validation.errors) {
        log.warn(`部分設定檔驗證失敗:\n${validation.errors.join('\n')}`);
      }
      
      if (Object.keys(validation.configs).length === 0) {
        log.warn('沒有可用的設定檔，創建範例設定檔...');
        createLlamaExamples(this.settingsDir);
        throw new Error('沒有可用的 Llama 設定檔，已創建範例設定檔，請編輯後重新啟動。');
      }
      
      log.info(`已載入 ${Object.keys(validation.configs).length} 個 Llama 設定檔`);
    } catch (error) {
      if (error.message.includes('目錄不存在') || error.message.includes('找不到任何設定檔')) {
        log.warn('創建 Llama 範例設定檔...');
        createLlamaExamples(this.settingsDir);
      }
      throw error;
    }
  }

  /** 讀取設定檔，回傳物件（async 版本） */
  async loadPreset(presetName) {
    const filePath = path.join(this.settingsDir, `${presetName}.json`);
    
    try {
      // 使用新的驗證系統載入設定檔
      const config = validateLlamaConfig(filePath, presetName);
      log.info(`Loaded and validated preset: ${presetName} from ${filePath}`);
      return config;
    } catch (error) {
      log.error(`Failed to load preset ${presetName}: ${error.message}`);
      throw error;
    }
  }

  buildArgs(config) {
    const args = [];
    args.push('-m', config.modelPath);
    const params = config.params || {};
    for (const [key, value] of Object.entries(params)) {
      const paramName = `--${key}`;
      if (typeof value === 'boolean') {
        if (value) args.push(paramName);
      } else {
        args.push(paramName, String(value));
      }
    }
    return args;
  }

  /** 用指定 preset 啟動（async 版本，會等到就緒） */
  async startWithPreset(presetName) {
    if (this.running) {
      log.warn(`Llama server is already running with preset: ${this.currentPreset}`);
      return;
    }

    const config = await this.loadPreset(presetName);
    this.currentPreset = presetName;
    const args = this.buildArgs(config);
    this.process = spawn(this.binPath, args);

    return new Promise((resolve, reject) => {
      this.process.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
          log.error(`[llama stderr] ${msg}`);
        } else if (msg.includes('server is listening on')) {
          this.running = true;
          log.info('✅ Llama server is ready and listening.');
          resolve(true);  // 👈 只有這裡才會 resolve
        } else {
          log.info(`[llama stderr] ${msg}`);
        }
      });

      this.process.on('exit', code => {
        this.running = false;
        log.info(`Llama server exited with code ${code}`);
      });

      this.process.on('error', err => {
        reject(err); // spawn 失敗會進這裡
      });
    });
  }


  async stop() {
    if (this.process && this.running) {
      log.info(`Stopping Llama server with preset: ${this.currentPreset}`);
      return new Promise((resolve, reject) => {
        this.process.once('exit', (code, signal) => {
          this.running = false;
          log.info(`Llama server exited with code: ${code}, signal: ${signal}`);
          resolve(true);
        });
        this.process.kill();
      });
    }
    return false; // 如果沒在執行，直接回傳 false
  }


  restartWithPreset(presetName) {
    log.info(`Restarting Llama server with preset: ${presetName}`);
    this.stop();
    setTimeout(() => this.startWithPreset(presetName), 1000);
  }

  isRunning() {
    return this.running;
  }
}

module.exports = LlamaServerManager;
