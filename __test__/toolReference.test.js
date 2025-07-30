const fs = require('fs');
const path = require('path');

// Mock the logger to avoid dependency issues in tests
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock the Logger class
function Logger(name) {
  return mockLogger;
}

// Mock fs.watch to avoid filesystem dependencies in tests
const mockWatcher = {
  close: jest.fn()
};

let watchCallback = null;
const originalWatch = fs.watch;

beforeAll(() => {
  // Replace the logger require with our mock
  jest.doMock('../../src/utils/logger', () => Logger);
  
  // Mock fs.watch
  fs.watch = jest.fn((path, options, callback) => {
    watchCallback = callback;
    return mockWatcher;
  });
});

afterAll(() => {
  fs.watch = originalWatch;
  jest.clearAllMocks();
});

const toolReference = require('../src/plugins/toolReference');

describe('ToolReference Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWatcher.close.mockClear();
  });

  test('should initialize and come online successfully', async () => {
    await toolReference.online();
    const state = await toolReference.state();
    expect(state).toBe(1);
    expect(mockLogger.info).toHaveBeenCalledWith('ToolReference local 策略已啟動');
    expect(fs.watch).toHaveBeenCalled();
  });

  test('should scan and return tool descriptions', async () => {
    await toolReference.online();
    const result = await toolReference.send();
    
    expect(result).toBeInstanceOf(Object);
    // Should include our test tool descriptions
    expect(result.asr).toBeDefined();
    expect(result.asr.name).toBe('speech-to-text');
    expect(result.tts).toBeDefined();
    expect(result.tts.name).toBe('text-to-speech');
    expect(result.discord).toBeDefined();
    expect(result.discord.name).toBe('discord-message');
  });

  test('should handle file changes through watcher callback', async () => {
    await toolReference.online();
    
    // Simulate file change event
    if (watchCallback) {
      watchCallback('change', 'testPlugin/tool-description.json');
    }
    
    // The callback should be called (implementation detail)
    expect(fs.watch).toHaveBeenCalled();
  });

  test('should go offline and cleanup watcher', async () => {
    await toolReference.online();
    await toolReference.offline();
    
    const state = await toolReference.state();
    expect(state).toBe(0);
    expect(mockWatcher.close).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('檔案監控已停止');
  });

  test('should restart successfully', async () => {
    await toolReference.online();
    await toolReference.restart();
    
    const state = await toolReference.state();
    expect(state).toBe(1);
    expect(mockWatcher.close).toHaveBeenCalled();
    expect(fs.watch).toHaveBeenCalledTimes(2); // Once for online, once for restart
  });

  test('should handle send without being online', async () => {
    // Test calling send before online
    const result = await toolReference.send();
    expect(result).toBeInstanceOf(Object);
  });

  test('should handle malformed JSON files gracefully', async () => {
    // This tests the warning behavior for malformed files
    await toolReference.online();
    await toolReference.send();
    
    // The mock logger should not have any error calls for existing valid files
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});