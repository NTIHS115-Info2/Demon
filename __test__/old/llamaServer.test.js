// __test__/llamaServer.test.js

const axios = require('axios');
const LlamaServerManager = require('../../Server/llama/llamaServer');

jest.setTimeout(60000);

describe('LlamaServerManager e2e 測試', () => {
  const presets = ['common-high', 'common-low', 'exclusive'];
  let manager;

  afterEach(async () => {
    if (manager) {
      manager.stop();
      // 等待 port 釋放
      await new Promise(r => setTimeout(r, 2000));
    }
  });

  for (const preset of presets) {
    test(`使用 preset="${preset}" 應回傳有效結果`, async () => {
      manager = new LlamaServerManager();
      await manager.startWithPreset(preset);
      // 等待伺服器就緒
      while (!manager.isRunning()) {
        await new Promise(r => setTimeout(r, 1000));
      }

      const resp = await axios.post(
        'http://localhost:8011/api/chat',
        { model: preset, messages: [{ role: 'user', content: '這是一則測試訊息' }], stream: false }
      );

      expect(Array.isArray(resp.data.choices)).toBe(true);
      expect(resp.data.choices[0]).toHaveProperty('message');
      expect(typeof resp.data.choices[0].message.content).toBe('string');
    });
  }
});
