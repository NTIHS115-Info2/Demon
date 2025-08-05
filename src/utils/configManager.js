const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

const logger = new Logger('configManager.log');

/**
 * 設定檔管理器 - 負責讀取、驗證和管理所有插件的設定檔
 */
class ConfigManager {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 載入並驗證設定檔
   * @param {string} configPath - 設定檔路徑
   * @param {object} schema - 驗證綱要
   * @param {string} pluginName - 插件名稱（用於錯誤訊息）
   * @returns {object} 驗證後的設定物件
   */
  loadAndValidate(configPath, schema, pluginName = 'Unknown') {
    const cacheKey = `${pluginName}_${configPath}`;
    
    // 檢查快取
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 檢查設定檔是否存在
      if (!fs.existsSync(configPath)) {
        const error = new Error(`[${pluginName}] 設定檔不存在: ${configPath}\n請創建設定檔或參考範例設定檔。`);
        error.code = 'CONFIG_NOT_FOUND';
        throw error;
      }

      // 讀取設定檔
      let config;
      try {
        // 使用專案根目錄的相對路徑並清除快取
        const moduleKey = require.resolve(configPath, { paths: [process.cwd()] });
        delete require.cache[moduleKey];     // ← 正確刪除 require.cache
        config = require(moduleKey);
      } catch (parseError) {
        const error = new Error(`[${pluginName}] 設定檔格式錯誤: ${parseError.message}`);
        error.code = 'CONFIG_PARSE_ERROR';
        throw error;
      }

      // 驗證必要欄位
      const validation = this.validateConfig(config, schema, pluginName);
      if (!validation.valid) {
        const error = new Error(`[${pluginName}] 設定檔驗證失敗:\n${validation.errors.join('\n')}`);
        error.code = 'CONFIG_VALIDATION_ERROR';
        throw error;
      }

      // 驗證檔案路徑
      if (schema.filePaths) {
        this.validateFilePaths(config, schema.filePaths, pluginName);
      }

      // 快取驗證後的設定
      this.cache.set(cacheKey, config);
      logger.info(`[${pluginName}] 設定檔載入成功: ${configPath}`);
      
      return config;
    } catch (error) {
      logger.error(`[${pluginName}] ${error.message}`);
      throw error;
    }
  }

  /**
   * 驗證設定物件（公開方法，用於測試）
   * @param {object} config - 設定物件
   * @param {object} schema - 驗證綱要  
   * @param {string} pluginName - 插件名稱
   * @returns {object} 驗證結果
   */
  validateConfigPublic(config, schema, pluginName) {
    return this.validateConfig(config, schema, pluginName);
  }

  /**
   * 驗證設定物件
   * @private
   */
  validateConfig(config, schema, pluginName) {
    const errors = [];

    // 檢查必要欄位
    if (schema.required) {
      for (const field of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(config, field)) {
          errors.push(`  - 缺少必要欄位: ${field}`);
        } else if (this.isEmpty(config[field])) {
          errors.push(`  - 欄位 ${field} 不可為空值`);
        }
      }
    }

    // 檢查欄位類型
    if (schema.types) {
      for (const [field, expectedType] of Object.entries(schema.types)) {
        if (config.hasOwnProperty(field)) {
          const actualType = typeof config[field];
          if (actualType !== expectedType) {
            errors.push(`  - 欄位 ${field} 類型錯誤: 期望 ${expectedType}，實際 ${actualType}`);
          }
        }
      }
    }

    // 檢查數值範圍
    if (schema.ranges) {
      for (const [field, range] of Object.entries(schema.ranges)) {
        if (config.hasOwnProperty(field)) {
          const value = config[field];
          if (typeof value === 'number') {
            if (range.min !== undefined && value < range.min) {
              errors.push(`  - 欄位 ${field} 值過小: 最小值 ${range.min}，實際 ${value}`);
            }
            if (range.max !== undefined && value > range.max) {
              errors.push(`  - 欄位 ${field} 值過大: 最大值 ${range.max}，實際 ${value}`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 驗證檔案路徑是否存在
   * @private
   */
  validateFilePaths(config, filePaths, pluginName) {
    for (const fieldName of filePaths) {
      if (config[fieldName]) {
        const filePath = config[fieldName];
        if (!fs.existsSync(filePath)) {
          const error = new Error(`[${pluginName}] 檔案路徑不存在: ${fieldName} = ${filePath}`);
          error.code = 'FILE_PATH_NOT_FOUND';
          throw error;
        }
      }
    }
  }

  /**
   * 檢查值是否為空
   * @private
   */
  isEmpty(value) {
    return value === null || 
           value === undefined || 
           value === '' || 
           (typeof value === 'string' && value.trim() === '') ||
           (Array.isArray(value) && value.length === 0) ||
           (typeof value === 'object' && Object.keys(value).length === 0);
  }

  /**
   * 清除快取
   */
  clearCache() {
    this.cache.clear();
    logger.info('設定檔快取已清除');
  }

  /**
   * 創建範例設定檔
   * @param {string} examplePath - 範例檔案路徑
   * @param {object} exampleContent - 範例內容
   * @param {string} pluginName - 插件名稱
   */
  createExampleConfig(examplePath, exampleContent, pluginName) {
    try {
      const dir = path.dirname(examplePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const content = `// ${pluginName} 設定檔範例
// 請複製此檔案為 config.js 並填入正確的值
// 所有標示為 "請填入" 的值都必須設定

module.exports = ${JSON.stringify(exampleContent, null, 2)};
`;

      fs.writeFileSync(examplePath, content, 'utf8');
      logger.info(`[${pluginName}] 範例設定檔已創建: ${examplePath}`);
    } catch (error) {
      logger.error(`[${pluginName}] 創建範例設定檔失敗: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new ConfigManager();