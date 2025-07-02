// llamaServerManager.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const Logger = require('../../src/core/logger.js');

// 設定 logger 基礎路徑
const log = new Logger('llama-server.log');

class LlamaServerManager {
  constructor(options = {}) {
    this.binPath = options.binPath || path.resolve(__dirname,'..' , 'llama_cpp_bin' ,'llama-server.exe');
    this.settingsDir = options.settingsDir || path.resolve(__dirname,'..' ,'settings');
    this.process = null;
    this.running = false;
    this.currentPreset = '';
  }

  /** 讀取設定檔，回傳物件 */
  loadPreset(presetName) {
    const filePath = path.join(this.settingsDir, `${presetName}.json`);
    if (!fs.existsSync(filePath)) throw new Error(`Preset not found: ${filePath}`);
    const data = fs.readFileSync(filePath, 'utf-8');
    log.info(`Loaded preset: ${presetName} from ${filePath}`);
    return JSON.parse(data);
  }

  /** 組參數 */
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

  /** 用指定 preset 啟動 */
  startWithPreset(presetName) { 
    try {
        if (this.running) {
            log.warn(`Llama server is already running with preset: ${this.currentPreset}`);
            return;
        };

        const config = this.loadPreset(presetName);
        this.currentPreset = presetName;
        const args = this.buildArgs(config);
    
        this.process = spawn(this.binPath, args);
        this.running = true;
    
        this.process.stdout.on('data', data => process.stdout.write(`[llama stdout] ${data}`));
        this.process.stderr.on('data', data => process.stderr.write(`[llama stderr] ${data}`));
        this.process.on('exit', code => {
        this.running = false;
        log.info(`Llama server exited with code ${code}`);
        });
    } catch (err) {
        this.restartWithPreset(presetName);
        log.error(`Failed to start Llama server with preset ${presetName}: ${err.message}`);
        return err;
    }
  }

  stop() {
    if (this.process && this.running) {
      log.info(`Stopping Llama server with preset: ${this.currentPreset}`);
      this.process.kill();
      this.running = false;
    }
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
