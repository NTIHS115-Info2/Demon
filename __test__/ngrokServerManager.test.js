const NgrokServerManager = require('../Server/ngrok/ngrokServer');

// Mock child_process and express to avoid actual startup
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    all: jest.fn(),
    listen: jest.fn()
  };
  const express = jest.fn(() => mockApp);
  express.json = jest.fn();
  return express;
});

jest.mock('../src/utils/logger.js', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

describe('NgrokServerManager - Enhanced Validation and Error Handling', () => {
  let manager;

  beforeEach(() => {
    manager = new NgrokServerManager();
  });

  describe('註冊子網域驗證改善', () => {
    test('should reject empty subdomain', () => {
      const result = manager.registerSubdomain('', () => {});
      expect(result).toBe(false);
    });

    test('should reject null subdomain', () => {
      const result = manager.registerSubdomain(null, () => {});
      expect(result).toBe(false);
    });

    test('should reject non-string subdomain', () => {
      const result = manager.registerSubdomain(123, () => {});
      expect(result).toBe(false);
    });

    test('should reject missing handler', () => {
      const result = manager.registerSubdomain('api');
      expect(result).toBe(false);
    });

    test('should reject null handler', () => {
      const result = manager.registerSubdomain('api', null);
      expect(result).toBe(false);
    });

    test('should reject non-function handler', () => {
      const result = manager.registerSubdomain('api', 'not a function');
      expect(result).toBe(false);
    });

    test('should accept valid parameters', () => {
      const result = manager.registerSubdomain('api', () => {});
      expect(result).toBe(true);
    });

    test('should handle duplicate registration with warning', () => {
      const handler1 = () => {};
      const handler2 = () => {};
      
      const result1 = manager.registerSubdomain('api', handler1);
      expect(result1).toBe(true);
      
      const result2 = manager.registerSubdomain('api', handler2);
      expect(result2).toBe(false);
      
      // Verify original handler is preserved
      expect(manager.handlers.get('api')).toBe(handler1);
    });
  });

  describe('解除子網域驗證改善', () => {
    test('should reject empty subdomain', () => {
      const result = manager.unregisterSubdomain('');
      expect(result).toBe(false);
    });

    test('should reject null subdomain', () => {
      const result = manager.unregisterSubdomain(null);
      expect(result).toBe(false);
    });

    test('should reject non-string subdomain', () => {
      const result = manager.unregisterSubdomain(123);
      expect(result).toBe(false);
    });

    test('should handle non-existent subdomain with warning', () => {
      const result = manager.unregisterSubdomain('nonexistent');
      expect(result).toBe(false);
    });

    test('should successfully unregister existing subdomain', () => {
      manager.registerSubdomain('api', () => {});
      const result = manager.unregisterSubdomain('api');
      expect(result).toBe(true);
      expect(manager.handlers.has('api')).toBe(false);
    });
  });

  describe('狀態管理', () => {
    test('should initialize with correct default state', () => {
      expect(manager.isRunning()).toBe(false);
      expect(manager.getUrl()).toBe(null);
      expect(manager.handlers.size).toBe(0);
    });

    test('should track handler count correctly', () => {
      expect(manager.handlers.size).toBe(0);
      
      manager.registerSubdomain('api1', () => {});
      expect(manager.handlers.size).toBe(1);
      
      manager.registerSubdomain('api2', () => {});
      expect(manager.handlers.size).toBe(2);
      
      manager.unregisterSubdomain('api1');
      expect(manager.handlers.size).toBe(1);
      
      manager.unregisterSubdomain('api2');
      expect(manager.handlers.size).toBe(0);
    });
  });

  describe('參數建置', () => {
    test('should build default args correctly', () => {
      const args = manager.buildArgs(3000);
      expect(args).toContain('http');
      expect(args).toContain('3000');
      expect(args).toContain('--log=stdout');
    });

    test('should handle custom command and extra args', () => {
      manager.command = 'tcp';
      manager.extraArgs = ['--region=ap', '--authtoken=test'];
      
      const args = manager.buildArgs(8080);
      expect(args).toContain('tcp');
      expect(args).toContain('8080');
      expect(args).toContain('--region=ap');
      expect(args).toContain('--authtoken=test');
      expect(args).toContain('--log=stdout');
    });
  });
});