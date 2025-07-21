// __test__/Talk2DemonIntegration.test.js

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const pluginManager = require('../../src/core/pluginsManager');
const TalkToDemon = require('../../src/core/TalkToDemon');

jest.setTimeout(60000);

describe('Talk2Demon 真實整合測試', () => {

  beforeAll(async () => {

    // 1. 載入 llamaServer 插件
    try {
      await pluginManager.loadPlugin('llamaServer');
    } catch (err) {
      throw new Error(`無法載入 llamaServer 插件: ${err.message}`);
    }

    // 2. 啟動 llamaServer
    await pluginManager.queueOnline('llamaServer', { preset: 'exclusive' });
    const state = await pluginManager.getPluginState('llamaServer');
    expect(state).toBe(1);
  });

  afterAll(async () => {
    // 停用所有 plugins
    await pluginManager.offlineAll();
  });

  test('pluginManager.send 真實回傳 EventEmitter，並能接收串流資料', async () => {
    const emitter = await pluginManager.send(
      'llamaServer',
      [{ role: 'user', content: '請做一個簡短的自我介紹' }]
    );
    expect(emitter).toBeInstanceOf(EventEmitter);

    let buffer = '';
    emitter.on('data', chunk => { buffer += chunk; });

    const result = await new Promise((resolve, reject) => {
      emitter.on('end', () => resolve(buffer));
      emitter.on('error', reject);
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('TalkToDemon.talk 真實串流回傳', done => {
    TalkToDemon.clearHistory();

    let buf = '';
    TalkToDemon.on('data', chunk => { buf += chunk; });
    TalkToDemon.on('end', () => {
      try {
        expect(buf.length).toBeGreaterThan(0);
        done();
      } catch (err) {
        done(err);
      }
    });
    TalkToDemon.on('error', err => done(err));

    TalkToDemon.talk('Tester', '請做一個簡短的自我介紹');
  });
});
