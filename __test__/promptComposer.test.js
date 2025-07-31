const composer = require('../src/core/PromptComposer');

describe('PromptComposer Enhanced Tests', () => {
  
  describe('validateMessage', () => {
    test('驗證正確格式的訊息', () => {
      const validMessage = { role: 'user', content: '測試訊息' };
      expect(() => composer.validateMessage(validMessage)).not.toThrow();
    });

    test('拒絕空物件', () => {
      expect(() => composer.validateMessage({})).toThrow('訊息必須包含有效的角色');
    });

    test('拒絕無效角色', () => {
      const invalidMessage = { role: 'invalid_role', content: '測試' };
      expect(() => composer.validateMessage(invalidMessage)).toThrow('不支援的訊息角色');
    });

    test('拒絕空內容', () => {
      const invalidMessage = { role: 'user', content: '' };
      expect(() => composer.validateMessage(invalidMessage)).toThrow('訊息必須包含有效的內容');
    });
  });

  describe('GetDefaultSystemPrompt', () => {
    test('成功取得系統提示', async () => {
      const prompt = await composer.GetDefaultSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('createToolMessage', () => {
    test('成功組合結果訊息', async () => {
      const msg = await composer.createToolMessage({
        called: true,
        toolName: 'mock',
        success: true,
        result: 'OK'
      });
      expect(msg.content).toContain('工具 mock 已執行');
      expect(msg.content).toContain('結果為: OK');
      expect(msg.role).toBe('tool');
      expect(msg.timestamp).toBeDefined();
    });

    test('失敗訊息', async () => {
      const msg = await composer.createToolMessage({
        called: true,
        toolName: 'mock',
        success: false
      });
      expect(msg.content).toContain('執行失敗');
      expect(msg.role).toBe('tool');
    });

    test('處理無效輸入', async () => {
      const msg = await composer.createToolMessage({ called: true });
      expect(msg.content).toContain('工具執行狀態異常');
      expect(msg.role).toBe('tool');
    });

    test('截斷過長結果', async () => {
      const longResult = 'x'.repeat(1500);
      const msg = await composer.createToolMessage({
        called: true,
        toolName: 'mock',
        success: true,
        result: longResult
      });
      expect(msg.content).toContain('已截斷');
      expect(msg.content.length).toBeLessThan(longResult.length + 100);
    });
  });

  describe('composeMessages', () => {
    test('基本訊息組合', async () => {
      const history = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '您好！' }
      ];
      
      const result = await composer.composeMessages(history);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].role).toBe('system');
    });

    test('工具結果插入邏輯', async () => {
      const history = [
        { role: 'user', content: '執行工具' },
        { role: 'assistant', content: '好的' }
      ];
      
      const toolResults = [
        { role: 'tool', content: '工具執行完成', timestamp: Date.now() }
      ];
      
      const result = await composer.composeMessages(history, toolResults);
      
      // 確認訊息順序：system → history → tools
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
      expect(result[3].role).toBe('tool');
      expect(result.length).toBe(4);
    });

    test('處理無效輸入參數', async () => {
      const result = await composer.composeMessages(null, 'invalid', {});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('system');
    });

    test('處理空陣列', async () => {
      const result = await composer.composeMessages([], [], []);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('system');
    });

    test('過濾無效訊息', async () => {
      const history = [
        { role: 'user', content: '有效訊息' },
        { role: 'invalid_role', content: '無效訊息' },
        { content: '缺少角色' },
        { role: 'assistant', content: '另一個有效訊息' }
      ];
      
      const result = await composer.composeMessages(history);
      
      // 只有有效訊息被保留（加上系統訊息）
      expect(result.length).toBe(3); // system + 2 valid messages
      expect(result.every(msg => ['system', 'user', 'assistant'].includes(msg.role))).toBe(true);
    });

    test('工具結果時間戳排序', async () => {
      const now = Date.now();
      const toolResults = [
        { role: 'tool', content: '後執行', timestamp: now + 1000 },
        { role: 'tool', content: '先執行', timestamp: now }
      ];
      
      const result = await composer.composeMessages([], toolResults);
      const toolMessages = result.filter(msg => msg.role === 'tool');
      
      expect(toolMessages[0].content).toBe('先執行');
      expect(toolMessages[1].content).toBe('後執行');
    });
  });

  describe('MESSAGE_ROLES 常數', () => {
    test('包含所有必要角色', () => {
      expect(composer.MESSAGE_ROLES.SYSTEM).toBe('system');
      expect(composer.MESSAGE_ROLES.USER).toBe('user');
      expect(composer.MESSAGE_ROLES.ASSISTANT).toBe('assistant');
      expect(composer.MESSAGE_ROLES.TOOL).toBe('tool');
    });
  });
});
