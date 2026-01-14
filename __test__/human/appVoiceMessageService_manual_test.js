/**
 * appVoiceMessageService 手動測試腳本
 * 
 * 用途：測試語音訊息服務的完整流程
 * 測試檔案：C:\Users\leoku\Downloads\voice-message.ogg
 * 
 * 執行方式：
 *   node __test__/human/appVoiceMessageService_manual_test.js
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// ───────────────────────────────────────────────
// 區段：設定
// ───────────────────────────────────────────────
const CONFIG = {
  // 伺服器設定
  serverPort: 80,
  serverHost: 'localhost',

  // 測試音檔路徑
  testAudioPath: 'C:\\Users\\leoku\\Downloads\\voice-message.ogg',

  // 測試使用者名稱
  username: 'test_user',

  // 輸出目錄（用於儲存回傳的音訊）
  outputDir: path.resolve(__dirname, 'output'),

  // 請求逾時（毫秒）
  timeout: 120000
};

// ───────────────────────────────────────────────
// 區段：工具函式
// ───────────────────────────────────────────────
function log(message, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}

function logError(message, ...args) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`, ...args);
}

function logSuccess(message, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ✅ ${message}`, ...args);
}

function logInfo(message, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ℹ️  ${message}`, ...args);
}

// ───────────────────────────────────────────────
// 區段：前置檢查
// ───────────────────────────────────────────────
async function preflightCheck() {
  log('執行前置檢查...');

  // 檢查測試音檔是否存在
  if (!fs.existsSync(CONFIG.testAudioPath)) {
    throw new Error(`測試音檔不存在: ${CONFIG.testAudioPath}`);
  }
  logSuccess(`測試音檔存在: ${CONFIG.testAudioPath}`);

  // 取得檔案資訊
  const stats = fs.statSync(CONFIG.testAudioPath);
  logInfo(`檔案大小: ${(stats.size / 1024).toFixed(2)} KB`);

  // 建立輸出目錄
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    logSuccess(`已建立輸出目錄: ${CONFIG.outputDir}`);
  }

  // 檢查伺服器健康狀態
  try {
    const healthUrl = `http://${CONFIG.serverHost}:${CONFIG.serverPort}/ios/HealthCheck`;
    const response = await axios.get(healthUrl, { timeout: 5000 });
    logSuccess(`伺服器健康檢查通過: ${JSON.stringify(response.data)}`);
  } catch (err) {
    throw new Error(`伺服器無法連線 (${CONFIG.serverHost}:${CONFIG.serverPort}): ${err.message}`);
  }
}

// ───────────────────────────────────────────────
// 區段：發送語音訊息
// ───────────────────────────────────────────────
async function sendVoiceMessage() {
  const url = `http://${CONFIG.serverHost}:${CONFIG.serverPort}/ios/BubbleChat`;
  log(`準備發送語音訊息至: ${url}`);

  // 建立 FormData
  const form = new FormData();
  form.append('file', fs.createReadStream(CONFIG.testAudioPath), {
    filename: path.basename(CONFIG.testAudioPath),
    contentType: 'audio/ogg'
  });
  form.append('username', CONFIG.username);

  const startTime = Date.now();
  log('開始發送請求...');

  try {
    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        'X-App-Client': 'test-script'
      },
      timeout: CONFIG.timeout,
      responseType: 'arraybuffer',
      validateStatus: () => true // 接受所有狀態碼
    });

    const duration = Date.now() - startTime;

    // 顯示回應標頭
    logInfo('回應標頭:');
    console.log('  - Status:', response.status);
    console.log('  - Content-Type:', response.headers['content-type']);
    console.log('  - X-Trace-Id:', response.headers['x-trace-id'] || 'N/A');
    console.log('  - X-Turn-Id:', response.headers['x-turn-id'] || 'N/A');
    console.log('  - X-ASR-Duration-Ms:', response.headers['x-asr-duration-ms'] || 'N/A');
    console.log('  - X-LLM-Duration-Ms:', response.headers['x-llm-duration-ms'] || 'N/A');
    console.log('  - X-TTS-Duration-Ms:', response.headers['x-tts-duration-ms'] || 'N/A');
    console.log('  - X-Transcode-Duration-Ms:', response.headers['x-transcode-duration-ms'] || 'N/A');

    // 檢查是否為成功回應
    if (response.status === 200 && response.headers['content-type']?.includes('audio')) {
      // 成功：儲存音訊檔案
      const outputFileName = `response_${Date.now()}.m4a`;
      const outputPath = path.join(CONFIG.outputDir, outputFileName);
      fs.writeFileSync(outputPath, response.data);

      logSuccess(`語音回覆已儲存: ${outputPath}`);
      logInfo(`檔案大小: ${(response.data.length / 1024).toFixed(2)} KB`);
      logSuccess(`總耗時: ${duration}ms`);

      return { success: true, outputPath, duration };
    } else {
      // 失敗：解析錯誤訊息
      let errorData;
      try {
        errorData = JSON.parse(response.data.toString('utf-8'));
      } catch {
        errorData = { raw: response.data.toString('utf-8').substring(0, 500) };
      }

      logError(`請求失敗 (HTTP ${response.status})`);
      console.log('錯誤內容:', JSON.stringify(errorData, null, 2));

      return { success: false, error: errorData, status: response.status, duration };
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logError(`請求例外: ${err.message}`);
    if (err.code) console.log('錯誤代碼:', err.code);

    return { success: false, error: err.message, duration };
  }
}

// ───────────────────────────────────────────────
// 區段：主程式
// ───────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  appVoiceMessageService 手動測試');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  try {
    // 前置檢查
    await preflightCheck();
    console.log('');

    // 發送語音訊息
    const result = await sendVoiceMessage();
    console.log('');

    // 顯示測試結果
    console.log('───────────────────────────────────────────────────────────');
    if (result.success) {
      console.log('🎉 測試成功！');
      console.log(`   輸出檔案: ${result.outputPath}`);
    } else {
      console.log('💥 測試失敗');
      console.log(`   錯誤: ${JSON.stringify(result.error)}`);
    }
    console.log(`   總耗時: ${result.duration}ms`);
    console.log('───────────────────────────────────────────────────────────');

  } catch (err) {
    logError('測試中止:', err.message);
    process.exit(1);
  }
}

// 執行
main();
