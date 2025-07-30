const PromptComposer = require('../src/core/PromptComposer');

/**
 * 展示 PromptComposer 完整功能的示例
 */
async function demonstratePromptComposer() {
  console.log('=== PromptComposer 功能展示 ===\n');

  try {
    // 1. 模擬對話歷史
    const conversationHistory = [
      { role: 'user', content: '我需要檢查服務器狀態' },
      { role: 'assistant', content: '我來幫您檢查服務器狀態。讓我先查看CPU使用情況。' },
      { role: 'user', content: '好的，謝謝' }
    ];

    // 2. 模擬工具執行結果
    const toolResults = [
      await PromptComposer.createToolMessage({
        called: true,
        toolName: 'systemInfo',
        success: true,
        result: 'CPU: 45%, Memory: 60%, Disk: 80%'
      }),
      await PromptComposer.createToolMessage({
        called: true,
        toolName: 'networkCheck',
        success: true,
        result: 'Network latency: 25ms, Status: Normal'
      })
    ];

    // 3. 額外的系統訊息
    const extraMessages = [
      { role: 'user', content: '請提供詳細分析' }
    ];

    console.log('1. 組合前各部分：');
    console.log('   對話歷史：', conversationHistory.length, '則訊息');
    console.log('   工具結果：', toolResults.length, '則結果');
    console.log('   額外訊息：', extraMessages.length, '則訊息');

    // 4. 使用 PromptComposer 組合最終訊息
    const finalMessages = await PromptComposer.composeMessages(
      conversationHistory,
      toolResults,
      extraMessages
    );

    console.log('\n2. 組合後的訊息結構：');
    finalMessages.forEach((msg, index) => {
      const preview = msg.content.length > 50 
        ? msg.content.substring(0, 50) + '...'
        : msg.content;
      console.log(`   ${index + 1}. [${msg.role}] ${preview}`);
    });

    // 5. 驗證所有訊息格式
    console.log('\n3. 格式驗證結果：');
    let validCount = 0;
    finalMessages.forEach((msg, index) => {
      try {
        PromptComposer.validateMessage(msg);
        validCount++;
      } catch (error) {
        console.log(`   ❌ 訊息 ${index + 1} 驗證失敗: ${error.message}`);
      }
    });
    console.log(`   ✅ ${validCount}/${finalMessages.length} 訊息通過驗證`);

    // 6. 展示工具結果插入邏輯
    console.log('\n4. 工具結果插入順序驗證：');
    const historyUserIndices = [];
    const toolIndices = [];
    
    // 只考慮原始歷史中的使用者訊息，不包含額外訊息
    conversationHistory.forEach((msg, index) => {
      if (msg.role === 'user') historyUserIndices.push(index + 1); // +1 因為有系統訊息
    });
    
    finalMessages.forEach((msg, index) => {
      if (msg.role === 'tool') toolIndices.push(index);
    });
    
    const lastHistoryUserIndex = Math.max(...historyUserIndices);
    const firstToolIndex = Math.min(...toolIndices);
    
    console.log(`   最後一個歷史使用者訊息位置: ${lastHistoryUserIndex + 1}`);
    console.log(`   第一個工具結果位置: ${firstToolIndex + 1}`);
    console.log(`   ✅ 工具結果正確插入在歷史使用者訊息之後: ${firstToolIndex > lastHistoryUserIndex}`);
    
    // 驗證訊息順序符合規範：system → history → tools → extra
    console.log('\n   訊息順序驗證：');
    const messageOrder = finalMessages.map(m => m.role);
    console.log(`   順序: ${messageOrder.join(' → ')}`);
    
    const systemIndex = messageOrder.indexOf('system');
    const firstToolIndex_order = messageOrder.indexOf('tool');
    const lastHistoryIndex = conversationHistory.length; // 系統訊息 + 歷史訊息數量
    
    console.log(`   ✅ 系統訊息在開頭: ${systemIndex === 0}`);
    console.log(`   ✅ 工具結果在歷史之後: ${firstToolIndex_order >= lastHistoryIndex}`);
    console.log(`   ✅ 額外訊息在最後: ${messageOrder[messageOrder.length - 1] === 'user'}`);

    console.log('\n5. 系統提示詞內容：');
    const systemPrompt = await PromptComposer.GetDefaultSystemPrompt();
    console.log(`   長度: ${systemPrompt.length} 字符`);
    console.log(`   預覽: ${systemPrompt.substring(0, 100)}...`);

    console.log('\n🎉 PromptComposer 功能展示完成！');

  } catch (error) {
    console.error('❌ 展示過程中發生錯誤:', error.message);
  }
}

// 執行展示
if (require.main === module) {
  demonstratePromptComposer();
}

module.exports = { demonstratePromptComposer };