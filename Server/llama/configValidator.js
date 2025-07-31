const path = require('path');
const fs = require('fs');
const configManager = require(path.resolve(__dirname, '..', '..', 'src', 'utils', 'configManager'));

// Llama 設定檔驗證綱要
const LLAMA_CONFIG_SCHEMA = {
  required: ['modelPath', 'params'],
  types: {
    modelPath: 'string',
    params: 'object'
  },
  filePaths: ['modelPath'], // 需要驗證存在的檔案路徑
  ranges: {
    'params.port': { min: 1000, max: 65535 },
    'params.threads': { min: 1, max: 64 },
    'params.ctx-size': { min: 512, max: 32768 },
    'params.n-gpu-layers': { min: 0, max: 999 },
    'params.batch-size': { min: 1, max: 2048 }
  }
};

/**
 * 驗證 Llama 設定檔
 * @param {string} presetPath - 設定檔路徑
 * @param {string} presetName - 設定檔名稱
 * @returns {object} 驗證後的設定物件
 */
function validateLlamaConfig(presetPath, presetName) {
  try {
    const config = configManager.loadAndValidate(presetPath, LLAMA_CONFIG_SCHEMA, `Llama-${presetName}`);
    
    // 額外驗證模型檔案副檔名
    const modelPath = config.modelPath;
    const validExtensions = ['.gguf', '.ggml', '.bin'];
    const ext = path.extname(modelPath).toLowerCase();
    
    if (!validExtensions.includes(ext)) {
      throw new Error(`[Llama-${presetName}] 不支援的模型檔案格式: ${ext}，支援的格式: ${validExtensions.join(', ')}`);
    }
    
    // 驗證必要參數
    if (!config.params.port) {
      throw new Error(`[Llama-${presetName}] 缺少必要參數: params.port`);
    }
    
    return config;
  } catch (error) {
    throw error;
  }
}

/**
 * 驗證所有 Llama 設定檔
 * @param {string} settingsDir - 設定檔目錄
 * @returns {object} 包含所有驗證結果的物件
 */
function validateAllLlamaConfigs(settingsDir) {
  const results = {};
  const errors = [];
  
  try {
    if (!fs.existsSync(settingsDir)) {
      throw new Error(`Llama 設定檔目錄不存在: ${settingsDir}`);
    }
    
    const files = fs.readdirSync(settingsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      throw new Error(`在 ${settingsDir} 中找不到任何設定檔`);
    }
    
    for (const file of jsonFiles) {
      const presetName = path.basename(file, '.json');
      const presetPath = path.join(settingsDir, file);
      
      try {
        results[presetName] = validateLlamaConfig(presetPath, presetName);
      } catch (error) {
        errors.push(error.message);
      }
    }
    
    if (errors.length > 0 && Object.keys(results).length === 0) {
      // 如果所有設定檔都失敗，拋出錯誤
      throw new Error(`所有 Llama 設定檔驗證失敗:\n${errors.join('\n')}`);
    }
    
    return {
      configs: results,
      errors: errors.length > 0 ? errors : null
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 創建 Llama 設定檔範例
 * @param {string} settingsDir - 設定檔目錄
 */
function createLlamaExamples(settingsDir) {
  const examples = {
    'example-low': {
      modelPath: "請填入模型檔案路徑/model.gguf",
      params: {
        "ctx-size": 4096,
        "n-gpu-layers": 0,
        "threads": 4,
        "batch-size": 64,
        "temp": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "repeat_penalty": 1.1,
        "port": 8011
      }
    },
    'example-high': {
      modelPath: "請填入模型檔案路徑/model.gguf",
      params: {
        "ctx-size": 8192,
        "n-gpu-layers": 32,
        "threads": 8,
        "batch-size": 128,
        "mirostat": 1,
        "mirostat-lr": 0.1,
        "mirostat-ent": 5.0,
        "temp": 0.7,
        "no-mmap": true,
        "port": 8012
      }
    }
  };
  
  try {
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    
    for (const [name, config] of Object.entries(examples)) {
      const filePath = path.join(settingsDir, `${name}.json`);
      if (!fs.existsSync(filePath)) {
        configManager.createExampleConfig(filePath, config, `Llama-${name}`);
      }
    }
  } catch (error) {
    console.error('創建 Llama 範例設定檔失敗:', error.message);
  }
}

module.exports = {
  validateLlamaConfig,
  validateAllLlamaConfigs,
  createLlamaExamples,
  LLAMA_CONFIG_SCHEMA
};