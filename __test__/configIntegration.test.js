const fs = require('fs');
const path = require('path');

// 設定檔整合測試
describe('設定檔整合測試', () => {
  const originalConfigPath = path.join('src', 'plugins', 'discord', 'config.js');
  const backupConfigPath = path.join('src', 'plugins', 'discord', 'config.js.backup');

  beforeAll(() => {
    // 備份原本的 Discord 設定檔
    if (fs.existsSync(originalConfigPath)) {
      fs.copyFileSync(originalConfigPath, backupConfigPath);
    }

  });

  afterAll(() => {
    // 還原 Discord 設定檔
    if (fs.existsSync(backupConfigPath)) {
      fs.copyFileSync(backupConfigPath, originalConfigPath);
      fs.unlinkSync(backupConfigPath);
    }
  });

  test('Discord 插件在缺少設定檔時應建立範例設定檔', () => {
    // 移除 Discord 設定檔
    if (fs.existsSync(originalConfigPath)) {
      fs.unlinkSync(originalConfigPath);
    }

    // 清除 require 快取以強制重新載入
    const configLoaderPath = path.join('src', 'plugins', 'discord', 'configLoader.js');
    delete require.cache[require.resolve(configLoaderPath, { paths: [process.cwd()] })];

    // 嘗試載入時應建立範例設定檔
    expect(() => {
      require('../src/plugins/discord/configLoader');
    }).toThrow('設定檔不存在');

    // 檢查範例檔案是否已建立
    const examplePath = path.join('src', 'plugins', 'discord', 'config.example.js');
    expect(fs.existsSync(examplePath)).toBe(true);

    const exampleContent = fs.readFileSync(examplePath, 'utf8');
    expect(exampleContent).toContain('Discord 設定檔範例');
    expect(exampleContent).toContain('YOUR_BOT_TOKEN_HERE');
  });

  test('Discord 插件應驗證必要欄位', () => {
    // 建立不合法的設定檔
    const invalidConfig = {
      token: '', // 空值
      applicationId: 'test-app-id',
      guildId: 'test-guild-id'
      // 缺少 channelId
    };
    
    fs.writeFileSync(originalConfigPath, `module.exports = ${JSON.stringify(invalidConfig, null, 2)};`);

    // 清除 require 快取
    const configLoaderPath = path.join('src', 'plugins', 'discord', 'configLoader.js');
    delete require.cache[require.resolve(configLoaderPath, { paths: [process.cwd()] })];

    expect(() => {
      require('../src/plugins/discord/configLoader');
    }).toThrow('設定檔驗證失敗');
  });

  test('歷史管理器應使用可設定的參數', async () => {
    const historyManager = require('../src/core/historyManager');
    
    // 測試預設設定是否載入
    expect(historyManager.config).toBeDefined();
    expect(historyManager.config.maxMessages).toBe(100);
    expect(historyManager.config.expireDays).toBe(7);
    
    // 測試統計功能
    const stats = await historyManager.getStats();
    expect(stats).toHaveProperty('config');
    expect(stats).toHaveProperty('cacheSize');
    expect(stats).toHaveProperty('historyFiles');
    expect(stats).toHaveProperty('totalSize');
  });

  test('範例設定檔應正確建立', () => {
    const configManager = require('../src/utils/configManager');
    const testDir = path.join('tmp', 'config-integration-test');
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

    // 清理測試資料夾
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});