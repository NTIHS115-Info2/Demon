const configManager = require('../src/utils/configManager');
const fs = require('fs');
const path = require('path');

// 創建臨時測試目錄
const TEST_DIR = path.join('/tmp', 'demon-config-test');
const TEST_CONFIG_PATH = path.join(TEST_DIR, 'test-config.js');

describe('configManager', () => {
  beforeAll(() => {
    // 確保測試目錄存在
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // 清理測試檔案
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // 清除快取
    configManager.clearCache();
    
    // 清理測試檔案
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  test('載入並驗證有效的設定檔', () => {
    // 創建測試設定檔
    const testConfig = {
      token: 'test-token',
      port: 8080,
      enabled: true
    };
    
    fs.writeFileSync(TEST_CONFIG_PATH, `module.exports = ${JSON.stringify(testConfig, null, 2)};`);
    
    const schema = {
      required: ['token', 'port'],
      types: {
        token: 'string',
        port: 'number',
        enabled: 'boolean'
      },
      ranges: {
        port: { min: 1000, max: 9999 }
      }
    };
    
    const result = configManager.loadAndValidate(TEST_CONFIG_PATH, schema, 'Test');
    
    expect(result).toEqual(testConfig);
  });

  test('設定檔不存在時拋出錯誤', () => {
    const schema = {
      required: ['token']
    };
    
    expect(() => {
      configManager.loadAndValidate('/non/existent/path.js', schema, 'Test');
    }).toThrow('[Test] 設定檔不存在');
  });

  test('缺少必要欄位時拋出錯誤', () => {
    // 創建缺少必要欄位的設定檔
    const testConfig = {
      port: 8080
    };
    
    fs.writeFileSync(TEST_CONFIG_PATH, `module.exports = ${JSON.stringify(testConfig, null, 2)};`);
    
    const schema = {
      required: ['token', 'port']
    };
    
    let threwError = false;
    let actualError = null;
    
    try {
      configManager.loadAndValidate(TEST_CONFIG_PATH, schema, 'TestMissingField');
    } catch (error) {
      threwError = true;
      actualError = error;
    }
    
    expect(threwError).toBe(true);
    expect(actualError).not.toBeNull();
    expect(actualError.message).toContain('缺少必要欄位: token');
  });

  test('空值驗證失敗', () => {
    // 創建包含空值的設定檔
    const testConfig = {
      token: '',
      port: 8080
    };
    
    fs.writeFileSync(TEST_CONFIG_PATH, `module.exports = ${JSON.stringify(testConfig, null, 2)};`);
    
    const schema = {
      required: ['token', 'port']
    };
    
    let threwError = false;
    let actualError = null;
    
    try {
      configManager.loadAndValidate(TEST_CONFIG_PATH, schema, 'TestEmptyValue');
    } catch (error) {
      threwError = true;
      actualError = error;
    }
    
    expect(threwError).toBe(true);
    expect(actualError).not.toBeNull();
    expect(actualError.message).toContain('欄位 token 不可為空值');
  });

  test('類型驗證失敗', () => {
    // 創建類型錯誤的設定檔
    const testConfig = {
      token: 'test-token',
      port: '8080' // 應該是 number 但是是 string
    };
    
    fs.writeFileSync(TEST_CONFIG_PATH, `module.exports = ${JSON.stringify(testConfig, null, 2)};`);
    
    const schema = {
      required: ['token', 'port'],
      types: {
        token: 'string',
        port: 'number'
      }
    };
    
    let threwError = false;
    let actualError = null;
    
    try {
      configManager.loadAndValidate(TEST_CONFIG_PATH, schema, 'TestTypeValidation');
    } catch (error) {
      threwError = true;
      actualError = error;
    }
    
    expect(threwError).toBe(true);
    expect(actualError).not.toBeNull();
    expect(actualError.message).toContain('欄位 port 類型錯誤');
  });

  test('數值範圍驗證失敗', () => {
    // 創建數值超出範圍的設定檔
    const testConfig = {
      token: 'test-token',
      port: 100 // 小於最小值
    };
    
    fs.writeFileSync(TEST_CONFIG_PATH, `module.exports = ${JSON.stringify(testConfig, null, 2)};`);
    
    const schema = {
      required: ['token', 'port'],
      types: {
        port: 'number'
      },
      ranges: {
        port: { min: 1000, max: 9999 }
      }
    };
    
    let threwError = false;
    let actualError = null;
    
    try {
      configManager.loadAndValidate(TEST_CONFIG_PATH, schema, 'TestRangeValidation');
    } catch (error) {
      threwError = true;
      actualError = error;
    }
    
    expect(threwError).toBe(true);
    expect(actualError).not.toBeNull();
    expect(actualError.message).toContain('欄位 port 值過小');
  });

  test('創建範例設定檔', () => {
    const examplePath = path.join(TEST_DIR, 'example.js');
    const exampleContent = {
      token: '請填入您的token',
      port: 8080
    };
    
    configManager.createExampleConfig(examplePath, exampleContent, 'Test');
    
    expect(fs.existsSync(examplePath)).toBe(true);
    
    const content = fs.readFileSync(examplePath, 'utf8');
    expect(content).toContain('Test 設定檔範例');
    expect(content).toContain('請填入您的token');
  });
});