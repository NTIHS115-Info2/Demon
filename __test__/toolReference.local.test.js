const toolReference = require('../src/plugins/toolReference');

describe('toolReference local 策略', () => {
  beforeAll(async () => {
    await toolReference.online();
  });

  afterAll(async () => {
    await toolReference.offline();
  });

  test('roughly 模式應提供工具清單摘要', async () => {
    const response = await toolReference.send({ roughly: true });

    expect(response).toBeTruthy();
    expect(response.success).toBe(true);
    expect(Array.isArray(response.tools)).toBe(true);
    expect(response.mode).toBe('roughly');
    expect(typeof response.generatedAt).toBe('string');
    expect(response.tools.length).toBeGreaterThan(0);

    for (const item of response.tools) {
      expect(item).toHaveProperty('toolName');
      expect(item).toHaveProperty('pluginName');
      expect(item).toHaveProperty('description');
    }
  });

  test('detail 模式應回傳指定工具的完整描述', async () => {
    const response = await toolReference.send('ToolName: getTime');

    expect(response.success).toBe(true);
    expect(response.mode).toBe('detail');
    expect(Array.isArray(response.tools)).toBe(true);
    expect(response.tools.length).toBe(1);

    const detail = response.tools[0];
    expect(detail.toolName).toBe('getTime');
    expect(detail.definition).toBeTruthy();
    expect(detail.definition.toolName).toBe('getTime');
    expect(detail.definition.description).toBeTruthy();
  });

  // 驗證以物件形式提出的單一工具查詢是否可正確回傳
  test('detail 模式可處理物件形式的單一工具查詢', async () => {
    const response = await toolReference.send({ toolName: 'getTime' });

    expect(response.success).toBe(true);
    expect(response.mode).toBe('detail');
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0].toolName).toBe('getTime');
  });

  // 確認多工具查詢可以依照輸入順序回傳結果
  test('detail 模式可處理多個工具查詢並保留原始順序', async () => {
    const response = await toolReference.send({ toolName: ['diffTime', 'getTime'] });

    expect(response.success).toBe(true);
    expect(response.mode).toBe('detail');
    expect(response.tools).toHaveLength(2);
    expect(response.tools[0].toolName).toBe('diffTime');
    expect(response.tools[1].toolName).toBe('getTime');
  });

  test('查詢不存在的工具時應回傳錯誤訊息', async () => {
    const response = await toolReference.send({ toolName: 'notExistTool' });

    expect(response.success).toBe(false);
    expect(response.error).toMatch('找不到');
    expect(Array.isArray(response.missing)).toBe(true);
    expect(response.missing).toContain('notExistTool');
  });

  // 驗證無法解析的字串輸入會提示改用 ToolName 查詢，且錯誤訊息不再提及 roughly
  test('不明字串請求會引導使用 ToolName 欄位', async () => {
    const response = await toolReference.send('just text without format');

    expect(response.success).toBe(false);
    expect(response.error).toMatch('ToolName');
    expect(response.error).not.toMatch(/roughly/i);
  });

  // 檢查不符合規範的欄位名稱是否會被阻擋並提示錯誤
  test('使用不支援的欄位名稱時應回報錯誤', async () => {
    const response = await toolReference.send({ ToolName: 'getTime' });

    expect(response.success).toBe(false);
    expect(response.error).toMatch('不支援的查詢欄位');
  });
});
