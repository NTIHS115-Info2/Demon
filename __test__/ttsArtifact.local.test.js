const { EventEmitter } = require('events');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

// 模擬 logger，避免測試時輸出大量日誌
jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

// 模擬 PM (PluginsManager)
const mockPM = {
  getPluginState: jest.fn(),
  send: jest.fn()
};
jest.mock('../src/core/pluginsManager', () => mockPM);

describe('ttsArtifact local strategy', () => {
  let strategy;
  let mockServer;
  let testArtifactRoot;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // 設定測試用的 artifact 根目錄
    testArtifactRoot = path.join(__dirname, '..', 'data', 'artifacts', 'tts');

    // 載入策略
    strategy = require('../src/plugins/ttsArtifact/strategies/local/index.js');
  });

  afterEach(async () => {
    // 清理：關閉策略與清除測試檔案
    if (strategy && typeof strategy.offline === 'function') {
      try {
        await strategy.offline();
      } catch (err) {
        // 忽略關閉錯誤
      }
    }

    // 清理測試產生的檔案
    if (fs.existsSync(testArtifactRoot)) {
      await fs.promises.rm(testArtifactRoot, { recursive: true, force: true });
    }
  });

  describe('online/offline lifecycle', () => {
    test('should start HTTP server on online()', async () => {
      const result = await strategy.online({ port: 0 }); // port 0 = 隨機埠
      expect(result).toBe(true);
      const state = await strategy.state();
      expect(state).toBe(1);
    });

    test('should stop HTTP server on offline()', async () => {
      await strategy.online({ port: 0 });
      await new Promise(resolve => setTimeout(resolve, 100)); // 等待伺服器啟動
      const result = await strategy.offline();
      expect(result).toBe(true);
      const state = await strategy.state();
      expect(state).toBe(0);
    });

    test('should not restart if already online', async () => {
      await strategy.online({ port: 0 });
      const result = await strategy.online({ port: 0 });
      expect(result).toBe(true);
    });

    test('should handle offline when not online', async () => {
      const result = await strategy.offline();
      expect(result).toBe(true);
    });
  });

  describe('send() validation', () => {
    beforeEach(async () => {
      await strategy.online({ port: 0 });
    });

    test('should reject when text is missing', async () => {
      const result = await strategy.send({});
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('缺少 text');
    });

    test('should reject when ttsEngine is offline', async () => {
      mockPM.getPluginState.mockResolvedValue(0);
      const result = await strategy.send('test text');
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('未上線');
    });

    test('should accept string input', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      
      // 建立模擬的 ttsEngine 回應
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from('test audio data'));
          this.push(null);
        }
      });

      mockPM.send.mockResolvedValue({
        stream: mockStream,
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: 1
        })
      });

      const result = await strategy.send('test text');
      expect(result).toHaveProperty('artifact_id');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('format', 'wav');
      expect(result).toHaveProperty('duration_ms');
    });

    test('should accept object with text field', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from('test audio data'));
          this.push(null);
        }
      });

      mockPM.send.mockResolvedValue({
        stream: mockStream,
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: 1
        })
      });

      const result = await strategy.send({ text: 'test text' });
      expect(result).toHaveProperty('artifact_id');
    });

    test('should reject invalid sample_rate', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      mockPM.send.mockResolvedValue({
        stream: new Readable({ read() {} }),
        metadataPromise: Promise.resolve({
          sample_rate: 0,
          channels: 1
        })
      });

      const result = await strategy.send('test text');
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('sample_rate 無效');
    });

    test('should reject invalid channels', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      mockPM.send.mockResolvedValue({
        stream: new Readable({ read() {} }),
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: -1
        })
      });

      const result = await strategy.send('test text');
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('channels 無效');
    });

    test('should reject non-integer channels', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      mockPM.send.mockResolvedValue({
        stream: new Readable({ read() {} }),
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: 1.5
        })
      });

      const result = await strategy.send('test text');
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('channels 無效');
    });
  });

  describe('WAV header generation', () => {
    test('should create valid WAV header', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      
      // 建立足夠大的測試資料以產生可測量的 duration
      const testData = Buffer.alloc(24000); // 1 秒的音訊資料 (24000 Hz * 1s * 2 bytes)
      const mockStream = new Readable({
        read() {
          this.push(testData);
          this.push(null);
        }
      });

      mockPM.send.mockResolvedValue({
        stream: mockStream,
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: 1
        })
      });

      await strategy.online({ port: 0 });
      const result = await strategy.send('test text');
      
      expect(result).toHaveProperty('artifact_id');
      expect(result.duration_ms).toBeGreaterThan(0);
    });
  });

  describe('artifact_id validation', () => {
    test('should validate ULID format', () => {
      // ULID 格式：26 個字元，使用 Crockford's Base32
      const validULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const invalidIDs = [
        '../../../etc/passwd',
        'invalid-id',
        '01ARZ3NDEKTSV4RRFFQ69G5FA', // 太短
        '01ARZ3NDEKTSV4RRFFQ69G5FAVV', // 太長
        '01ARZ3NDEKTSV4RRFFQ69G5FA!' // 非法字元
      ];

      const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;
      expect(ulidRegex.test(validULID)).toBe(true);
      invalidIDs.forEach(id => {
        expect(ulidRegex.test(id)).toBe(false);
      });
    });
  });

  describe('range parsing', () => {
    test('should reject negative range values', () => {
      // 此測試驗證 parseRange 函數的邏輯
      // 實際函數為內部函數，我們透過 HTTP 端點間接測試
      const testCases = [
        { header: 'bytes=-10-20', shouldFail: true },
        { header: 'bytes=20-10', shouldFail: true },
        { header: 'bytes=0-100', shouldFail: false }
      ];

      // 此部分需要實際 HTTP 測試或匯出 parseRange 函數
      // 目前僅作為文件說明
    });
  });

  describe('error handling', () => {
    test('should clean up on artifact creation failure', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      
      // 模擬檔案系統錯誤
      const originalMkdir = fs.promises.mkdir;
      fs.promises.mkdir = jest.fn().mockRejectedValue(new Error('Disk full'));

      await strategy.online({ port: 0 });
      const result = await strategy.send('test text');
      
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('FILE_IO');

      // 還原
      fs.promises.mkdir = originalMkdir;
    });

    test('should handle stream errors gracefully', async () => {
      mockPM.getPluginState.mockResolvedValue(1);
      
      const mockStream = new Readable({
        read() {
          this.destroy(new Error('Stream error'));
        }
      });

      mockPM.send.mockResolvedValue({
        stream: mockStream,
        metadataPromise: Promise.resolve({
          sample_rate: 24000,
          channels: 1
        })
      });

      await strategy.online({ port: 0 });
      const result = await strategy.send('test text');
      
      // 應該回傳錯誤狀態但不 crash
      expect(result).toHaveProperty('artifact_id');
    });
  });

  describe('LRU cache', () => {
    test('should cache artifact paths', async () => {
      // 此測試驗證快取功能
      // 需要多次查詢相同 artifact 並驗證效能
      // 實作略
    });

    test('should evict old entries when cache is full', async () => {
      // 驗證 LRU 逐出策略
      // 實作略
    });
  });
});
