const axios = require('axios');

const LlamaServerManager = require('../Server/llama/llamaServer.js');
const Logger = require('../src/core/logger.js');

const log = new Logger(`llama-server-${presetName}.log`);

const presets = ['common-high', 'common-low', 'exclusive'];

// 每次使用一個新的 manager 實例
async function testWithPreset(presetName) {
  const manager = new LlamaServerManager();
  

  log.info(`\n\n🧪 開始測試預設：${presetName}`);
  manager.startWithPreset(presetName);

  // 等待伺服器啟動
  while (manager.isRunning() === false) {
    log.info(`等待伺服器啟動...`);
    await new Promise(resolve => setTimeout(resolve, 5000));  
  };
  
  try {
    const response = await axios.post('http://localhost:8011/api/chat', {
      model: presetName,
      messages: [
        { role: 'user', content: '這是一則測試訊息' }
      ],
      stream: false
    });

    log.info(`✅ [${presetName}] 回應：`, response.data.message?.content || response.data);

  } catch (err) {
    log.error(`❌ [${presetName}] 發送失敗：`, err.code || '', err.message || '', err.response?.data || '', err);
  } finally {
    manager.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // 確保 port 已釋放
  }
}

(async () => {
  for (const preset of presets) {
    await testWithPreset(preset);
  }
  log.info('所有預設測試完成！');
})();
