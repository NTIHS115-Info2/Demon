const fs = require('fs');
const path = require('path');
const Logger = require('../src/utils/logger');
const { SetConsoleLog } = require('../src/utils/logger');
const GlobalErrorHandler = require('../src/utils/globalErrorHandler');

describe('Logger 敏感資訊過濾', () => {
  let logger;
  
  beforeAll(() => {
    // 設定測試用的日誌路徑
    Logger.SetConsoleLog(false); // 關閉控制台輸出以避免測試污染
    logger = new Logger('test-sensitive-filter.log');
  });

  test('應該過濾 Token 資訊', () => {
    const message = 'API Token: abc123def456ghi789';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toContain('abc***************');
    expect(filtered).not.toContain('abc123def456ghi789');
  });

  test('應該過濾 API Key 資訊', () => {
    const message = 'api_key=sk-1234567890abcdef';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toContain('sk-***************');
    expect(filtered).not.toContain('sk-1234567890abcdef');
  });

  test('應該過濾密碼資訊', () => {
    const message = 'password: mySecretPassword123';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toContain('myS****************');
    expect(filtered).not.toContain('mySecretPassword123');
  });

  test('應該過濾 Email 地址', () => {
    const message = 'User email: user@example.com';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toContain('use***');
    expect(filtered).not.toContain('user@example.com');
  });

  test('應該過濾信用卡號', () => {
    const message = 'Credit card: 1234-5678-9012-3456';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toContain('123***');
    expect(filtered).not.toContain('1234-5678-9012-3456');
  });

  test('應該保留正常訊息不變', () => {
    const message = 'This is a normal log message without sensitive info';
    const filtered = Logger.filterSensitiveInfo(message);
    expect(filtered).toBe(message);
  });

  test('hasSensitiveInfo 應該正確檢測敏感資訊', () => {
    expect(Logger.hasSensitiveInfo('token: abc123')).toBe(true);
    expect(Logger.hasSensitiveInfo('normal message')).toBe(false);
    expect(Logger.hasSensitiveInfo('email: test@example.com')).toBe(true);
  });

  test('應該處理非字串輸入', () => {
    const numberInput = 12345;
    const filtered = Logger.filterSensitiveInfo(numberInput);
    expect(typeof filtered).toBe('string');
    expect(filtered).toBe('12345');
  });
});

describe('GlobalErrorHandler', () => {
  beforeEach(() => {
    // 重置 GlobalErrorHandler 狀態 (如果有重置方法的話)
    // 注意：實際實現中可能需要添加重置方法用於測試
  });

  test('應該能夠初始化', () => {
    expect(() => {
      GlobalErrorHandler.init({
        logFileName: 'test-global-errors.log',
        exitOnUncaught: false
      });
    }).not.toThrow();
    
    expect(GlobalErrorHandler.isInitialized()).toBe(true);
  });

  test('wrapAsync 應該捕獲錯誤並重新拋出', async () => {
    const errorMessage = 'Test async error';
    const failingAsyncFunction = async () => {
      throw new Error(errorMessage);
    };

    const wrappedFunction = GlobalErrorHandler.wrapAsync(failingAsyncFunction, {
      module: 'TestModule'
    });

    await expect(wrappedFunction()).rejects.toThrow(errorMessage);
  });

  test('wrapAsync 應該允許成功的函數正常執行', async () => {
    const successValue = 'success';
    const successAsyncFunction = async () => {
      return successValue;
    };

    const wrappedFunction = GlobalErrorHandler.wrapAsync(successAsyncFunction);
    const result = await wrappedFunction();
    
    expect(result).toBe(successValue);
  });

  test('logError 應該能記錄手動錯誤', () => {
    // 確保已初始化
    if (!GlobalErrorHandler.isInitialized()) {
      GlobalErrorHandler.init();
    }

    const testError = new Error('Test manual error');
    const context = { module: 'TestModule', action: 'testAction' };

    expect(() => {
      GlobalErrorHandler.logError(testError, context);
    }).not.toThrow();
  });
});

describe('日誌檔案操作', () => {
  let logger;
  let logPath;

  beforeAll(() => {
    SetConsoleLog(false);
    logger = new Logger('test-file-operations.log');
    logPath = logger.getLogPath();
  });

  test('應該建立日誌目錄', () => {
    expect(fs.existsSync(logPath)).toBe(true);
  });

  test('應該建立日誌檔案', () => {
    logger.info('Test log message');
    
    // 給檔案寫入一些時間
    setTimeout(() => {
      const logFiles = fs.readdirSync(logPath);
      expect(logFiles).toContain('test-file-operations.log');
    }, 100);
  });

  test('getLogPath 應該回傳正確路徑', () => {
    const returnedPath = logger.getLogPath();
    expect(returnedPath).toBe(logPath);
    // 相對路徑不應為絕對路徑
    expect(path.isAbsolute(returnedPath)).toBe(false);
  });

  test('logRaw 應該記錄原始訊息', () => {
    const sensitiveMessage = 'token: abc123sensitive';
    
    // 這應該不會過濾敏感資訊
    expect(() => {
      logger.logRaw('INFO', sensitiveMessage);
    }).not.toThrow();
  });
});

describe('日誌格式化', () => {
  let logger;

  beforeAll(() => {
    SetConsoleLog(false);
    logger = new Logger('test-formatting.log');
  });

  test('format 方法應該包含時間戳和級別', () => {
    const message = 'Test message';
    const formatted = logger.format('INFO', message);
    
    expect(formatted).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/); // ISO 時間戳
    expect(formatted).toContain('INFO');
    expect(formatted).toContain('Test message');
  });

  test('不同日誌級別應該正確格式化', () => {
    const message = 'Test message';
    
    const infoFormatted = logger.format('INFO', message);
    const warnFormatted = logger.format('WARN', message);
    const errorFormatted = logger.format('ERROR', message);
    
    expect(infoFormatted).toContain('INFO');
    expect(warnFormatted).toContain('WARN');
    expect(errorFormatted).toContain('ERROR');
  });
});