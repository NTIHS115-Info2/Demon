const fs = require('fs');
const path = require('path');

// Test configuration error reporting
describe('Configuration Integration Tests', () => {
  const originalConfigPath = path.join(__dirname, '..', 'src', 'plugins', 'discord', 'config.js');
  const backupConfigPath = path.join(__dirname, '..', 'src', 'plugins', 'discord', 'config.js.backup');

  beforeAll(() => {
    // Backup existing Discord config
    if (fs.existsSync(originalConfigPath)) {
      fs.copyFileSync(originalConfigPath, backupConfigPath);
    }
  });

  afterAll(() => {
    // Restore backup config
    if (fs.existsSync(backupConfigPath)) {
      fs.copyFileSync(backupConfigPath, originalConfigPath);
      fs.unlinkSync(backupConfigPath);
    }
  });

  test('Discord plugin should create example config when config is missing', () => {
    // Remove Discord config
    if (fs.existsSync(originalConfigPath)) {
      fs.unlinkSync(originalConfigPath);
    }

    // Clear require cache to force reload
    const configLoaderPath = path.join(__dirname, '..', 'src', 'plugins', 'discord', 'configLoader.js');
    delete require.cache[require.resolve(configLoaderPath)];

    // Attempting to load should create example config
    expect(() => {
      require('../src/plugins/discord/configLoader');
    }).toThrow('設定檔不存在');

    // Check that example was created
    const examplePath = path.join(__dirname, '..', 'src', 'plugins', 'discord', 'config.example.js');
    expect(fs.existsSync(examplePath)).toBe(true);

    const exampleContent = fs.readFileSync(examplePath, 'utf8');
    expect(exampleContent).toContain('Discord 設定檔範例');
    expect(exampleContent).toContain('請填入您的Discord Bot Token');
  });

  test('Discord plugin should validate required fields', () => {
    // Create invalid config
    const invalidConfig = {
      token: '', // Empty value
      applicationId: 'test-app-id',
      guildId: 'test-guild-id'
      // Missing channelId
    };
    
    fs.writeFileSync(originalConfigPath, `module.exports = ${JSON.stringify(invalidConfig, null, 2)};`);

    // Clear require cache
    const configLoaderPath = path.join(__dirname, '..', 'src', 'plugins', 'discord', 'configLoader.js');
    delete require.cache[require.resolve(configLoaderPath)];

    expect(() => {
      require('../src/plugins/discord/configLoader');
    }).toThrow('設定檔驗證失敗');
  });

  test('History manager should use configurable settings', () => {
    const historyManager = require('../src/core/historyManager');
    
    // Test default configuration is loaded
    expect(historyManager.config).toBeDefined();
    expect(historyManager.config.maxMessages).toBe(100);
    expect(historyManager.config.expireDays).toBe(7);
    
    // Test statistics functionality
    const stats = historyManager.getStats();
    expect(stats).toHaveProperty('config');
    expect(stats).toHaveProperty('cacheSize');
    expect(stats).toHaveProperty('historyFiles');
    expect(stats).toHaveProperty('totalSize');
  });

  test('Example configurations should be created correctly', () => {
    const configManager = require('../src/utils/configManager');
    const testDir = '/tmp/config-integration-test';
    const testPath = path.join(testDir, 'test-example.js');
    
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const exampleContent = {
      apiKey: '請填入您的API密鑰',
      endpoint: 'https://api.example.com',
      timeout: 5000
    };

    configManager.createExampleConfig(testPath, exampleContent, 'TestPlugin');

    expect(fs.existsSync(testPath)).toBe(true);
    
    const content = fs.readFileSync(testPath, 'utf8');
    expect(content).toContain('TestPlugin 設定檔範例');
    expect(content).toContain('請填入您的API密鑰');
    expect(content).toContain('所有標示為 "請填入" 的值都必須設定');

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});