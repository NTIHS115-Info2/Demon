// 版本 1.0 審查 - 插件系統完整性測試
const path = require('path');
const fs = require('fs');

describe('Version 1.0 Plugin System Review', () => {
  const pluginsPath = path.resolve(__dirname, '../src/plugins');
  const expectedPlugins = ['asr', 'discord', 'llamaServer', 'ngrok', 'speechBroker', 'tts'];
  
  test('所有預期的插件目錄都存在', () => {
    const actualPlugins = fs.readdirSync(pluginsPath).filter(dir => 
      fs.statSync(path.join(pluginsPath, dir)).isDirectory()
    );
    
    expect(actualPlugins.sort()).toEqual(expectedPlugins.sort());
  });
  
  test('所有插件都有 index.js 文件', () => {
    expectedPlugins.forEach(pluginName => {
      const indexPath = path.join(pluginsPath, pluginName, 'index.js');
      expect(fs.existsSync(indexPath)).toBe(true);
    });
  });
  
  test('所有插件都能正確載入且具有必要方法', () => {
    const requiredMethods = ['online', 'offline', 'restart', 'state', 'updateStrategy'];
    
    expectedPlugins.forEach(pluginName => {
      const pluginPath = path.join(pluginsPath, pluginName, 'index.js');
      
      // 嘗試載入插件
      let plugin;
      expect(() => {
        plugin = require(pluginPath);
      }).not.toThrow();
      
      // 檢查必要方法
      requiredMethods.forEach(method => {
        expect(typeof plugin[method]).toBe('function');
      });
    });
  });
  
  test('所有插件都有策略架構', () => {
    expectedPlugins.forEach(pluginName => {
      const strategiesPath = path.join(pluginsPath, pluginName, 'strategies');
      expect(fs.existsSync(strategiesPath)).toBe(true);
      
      const indexPath = path.join(strategiesPath, 'index.js');
      expect(fs.existsSync(indexPath)).toBe(true);
    });
  });
  
  test('插件策略能正確載入且有 priority 屬性', () => {
    expectedPlugins.forEach(pluginName => {
      const strategiesIndexPath = path.join(pluginsPath, pluginName, 'strategies', 'index.js');
      
      let strategies;
      expect(() => {
        strategies = require(strategiesIndexPath);
      }).not.toThrow();
      
      // 檢查至少有一個策略
      expect(Object.keys(strategies).length).toBeGreaterThan(0);
      
      // 檢查每個策略都有 priority 屬性
      Object.values(strategies).forEach(strategy => {
        expect(typeof strategy.priority).toBe('number');
      });
    });
  });
});