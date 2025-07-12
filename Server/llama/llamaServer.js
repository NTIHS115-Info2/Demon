const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('../../src/utils/logger.js');
const log = new Logger('llama-server.log');

class LlamaServerManager {
  constructor(options = {}) {
    this.binPath = options.binPath || path.resolve(__dirname, 'llama_cpp_bin' ,'llama-server.exe');
    this.settingsDir = options.settingsDir || path.resolve(__dirname,'settings');
    this.process = null;
    this.running = false;
    this.currentPreset = '';
  }

  /** 讀取設定檔，回傳物件（async 版本） */
  async loadPreset(presetName) {
    const filePath = path.join(this.settingsDir, `${presetName}.json`);
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch {
      throw new Error(`Preset not found: ${filePath}`);
    }
    const data = await fs.promises.readFile(filePath, 'utf-8');
    log.info(`Loaded preset: ${presetName} from ${filePath}`);
    return JSON.parse(data);
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
