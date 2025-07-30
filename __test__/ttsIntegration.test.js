const { EventEmitter } = require('events');

// Mock TalkToDemon
jest.mock('../src/core/TalkToDemon.js', () => {
  const { EventEmitter } = require('events');
  const t = new EventEmitter();
  t.on = jest.fn(t.on.bind(t));
  t.off = jest.fn(t.off.bind(t));
  return Object.assign(t, {
    closeGate: jest.fn(),
    openGate: jest.fn(),
    manualAbort: jest.fn(),
    talk: jest.fn(),
    getState: jest.fn(() => 'busy'),
    getGateState: jest.fn(() => 'open')
  });
}, { virtual: true });

// Mock python-shell
jest.mock('python-shell', () => {
  const { EventEmitter } = require('events');
  return {
    PythonShell: jest.fn().mockImplementation((script, options) => {
      const emitter = new EventEmitter();
      emitter.script = script;
      emitter.options = options;
      emitter.terminated = false;
      emitter.stdin = true;
      emitter.send = jest.fn();
      emitter.end = (cb) => { 
        emitter.terminated = true; 
        setTimeout(() => cb && cb(null, 0, null), 10);
      };
      return emitter;
    })
  };
}, { virtual: true });

// Mock PluginsManager
jest.mock('../src/core/pluginsManager.js', () => ({
  send: jest.fn(),
  getPluginState: jest.fn()
}), { virtual: true });

const ttsPlugin = require('../src/plugins/tts');
const speechBrokerPlugin = require('../src/plugins/speechBroker');
const talkerMock = require('../src/core/TalkToDemon.js');
const pmMock = require('../src/core/pluginsManager.js');

describe('TTS Plugin Integration Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await ttsPlugin.offline();
    await speechBrokerPlugin.offline();
  }, 10000); // Increase timeout for beforeEach

  afterEach(async () => {
    await ttsPlugin.offline();
    await speechBrokerPlugin.offline();
  }, 10000);

  describe('Local voice engine continuous playback testing', () => {
    test('TTS local strategy handles multiple consecutive send operations', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();

      // Send multiple messages consecutively
      const result1 = await ttsPlugin.send('First message');
      const result2 = await ttsPlugin.send('Second message');
      const result3 = await ttsPlugin.send('Third message');

      // Verify all sends succeeded
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);

      // Verify TTS plugin is still online after multiple sends
      expect(await ttsPlugin.state()).toBe(1);
    });

    test('TTS local strategy maintains state during continuous playback', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();

      // Verify initial state
      expect(await ttsPlugin.state()).toBe(1);

      // Send messages and verify state remains stable
      await ttsPlugin.send('Message 1');
      expect(await ttsPlugin.state()).toBe(1);
      
      await ttsPlugin.send('Message 2');
      expect(await ttsPlugin.state()).toBe(1);
    });

    test('TTS send returns false when trying to send to offline process', async () => {
      await ttsPlugin.updateStrategy('local');
      
      // Try to send without being online
      const result = await ttsPlugin.send('Test message');
      expect(result).toBe(false);
    });

    test('TTS handles rapid consecutive sends without issues', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();

      // Send 10 messages rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(ttsPlugin.send(`Rapid message ${i + 1}`));
      }
      
      const results = await Promise.all(promises);
      
      // All sends should succeed
      results.forEach(result => expect(result).toBe(true));
      
      // Verify TTS is still online after rapid sends
      expect(await ttsPlugin.state()).toBe(1);
    });
  });

  describe('Offline functionality - stop playback and release resources', () => {
    test('TTS offline properly terminates Python process and releases resources', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();

      // Verify process is running
      expect(await ttsPlugin.state()).toBe(1);

      // Stop and verify cleanup
      await ttsPlugin.offline();
      expect(await ttsPlugin.state()).toBe(0);
    });

    test('TTS offline can be called multiple times safely', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();

      // Should not throw when called multiple times
      await expect(ttsPlugin.offline()).resolves.toBe(0);
      await expect(ttsPlugin.offline()).resolves.toBe(0);
      expect(await ttsPlugin.state()).toBe(0);
    });

    test('TTS send fails after offline', async () => {
      await ttsPlugin.updateStrategy('local');
      await ttsPlugin.online();
      
      // Verify send works when online
      expect(await ttsPlugin.send('Test message')).toBe(true);
      
      // Go offline
      await ttsPlugin.offline();
      
      // Verify send fails when offline
      expect(await ttsPlugin.send('Test message')).toBe(false);
    });
  });

  describe('SpeechBroker integration - skip voice output when TTS not online', () => {
    test('SpeechBroker checks TTS state before sending and warns when offline', async () => {
      // Mock TTS as offline
      pmMock.getPluginState.mockResolvedValue(0);
      
      await speechBrokerPlugin.online();

      // Simulate data from TalkToDemon
      talkerMock.emit('data', 'Hello world.');
      
      // Wait for async processing with longer timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify getPluginState was called to check TTS status
      expect(pmMock.getPluginState).toHaveBeenCalledWith('tts');
      
      // Verify no message was sent to TTS when offline
      expect(pmMock.send).not.toHaveBeenCalled();
    });

    test('SpeechBroker sends to TTS when it is online', async () => {
      // Mock TTS as online
      pmMock.getPluginState.mockResolvedValue(1);
      
      await speechBrokerPlugin.online();

      // Simulate data from TalkToDemon
      talkerMock.emit('data', 'Hello world.');
      
      // Wait for async processing with longer timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify message was sent to TTS when online
      expect(pmMock.send).toHaveBeenCalledWith('tts', 'Hello world.');
    });

    test('SpeechBroker handles TTS state changes gracefully', async () => {
      await speechBrokerPlugin.online();

      // First message with TTS online
      pmMock.getPluginState.mockResolvedValue(1);
      talkerMock.emit('data', 'First message.');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(pmMock.send).toHaveBeenCalledWith('tts', 'First message.');

      jest.clearAllMocks();

      // Second message with TTS offline
      pmMock.getPluginState.mockResolvedValue(0);
      talkerMock.emit('data', 'Second message.');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(pmMock.send).not.toHaveBeenCalled();
    });
  });
});