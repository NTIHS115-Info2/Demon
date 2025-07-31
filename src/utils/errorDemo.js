const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const Logger = require('../utils/logger');
const GlobalErrorHandler = require('../utils/globalErrorHandler');

const logger = new Logger('error-demo.log');

/**
 * 錯誤處理示範模組
 * 展示各種常見的錯誤情境及其處理方式
 */
class ErrorDemoModule {

    /**
     * 示範 I/O 錯誤處理
     */
    static async demonstrateIOErrors() {
        logger.info('開始示範 I/O 錯誤處理...');

        // 示範 1: 檔案不存在錯誤
        try {
            const nonExistentFile = path.join(__dirname, 'non-existent-file.txt');
            await fs.readFile(nonExistentFile, 'utf8');
        } catch (error) {
            logger.error(`檔案讀取失敗: ${error.message}`);
            logger.info('正確處理: 檔案不存在錯誤已被捕獲');
        }

        // 示範 2: 權限錯誤 (嘗試寫入根目錄)
        try {
            await fs.writeFile('/root/test.txt', 'test content');
        } catch (error) {
            logger.error(`檔案寫入失敗: ${error.message}`);
            logger.info('正確處理: 權限錯誤已被捕獲');
        }

        // 示範 3: 目錄操作錯誤
        try {
            await fs.mkdir('/root/test-dir');
        } catch (error) {
            logger.error(`目錄建立失敗: ${error.message}`);
            logger.info('正確處理: 目錄操作錯誤已被捕獲');
        }

        // 示範 4: JSON 解析錯誤
        try {
            const invalidJson = '{"invalid": json}';
            JSON.parse(invalidJson);
        } catch (error) {
            logger.error(`JSON 解析失敗: ${error.message}`);
            logger.info('正確處理: JSON 解析錯誤已被捕獲');
        }

        logger.info('I/O 錯誤處理示範完成');
    }

    /**
     * 示範 API 超時錯誤處理
     */
    static async demonstrateAPITimeouts() {
        logger.info('開始示範 API 超時錯誤處理...');

        // 示範 1: 連接超時
        try {
            logger.info('測試連接超時 (timeout: 100ms)...');
            await axios.get('https://httpbin.org/delay/1', {
                timeout: 100 // 100ms 超時
            });
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                logger.error(`API 連接超時: ${error.message}`);
                logger.info('正確處理: 連接超時錯誤已被捕獲');
            } else {
                logger.error(`其他網路錯誤: ${error.message}`);
            }
        }

        // 示範 2: 無效的 URL
        try {
            logger.info('測試無效 URL 錯誤...');
            await axios.get('http://invalid-domain-that-does-not-exist-12345.com');
        } catch (error) {
            logger.error(`無效 URL 錯誤: ${error.message}`);
            logger.info('正確處理: DNS 解析錯誤已被捕獲');
        }

        // 示範 3: HTTP 錯誤狀態碼
        try {
            logger.info('測試 HTTP 404 錯誤...');
            await axios.get('https://httpbin.org/status/404');
        } catch (error) {
            if (error.response) {
                logger.error(`HTTP 錯誤: ${error.response.status} - ${error.response.statusText}`);
                logger.info('正確處理: HTTP 狀態錯誤已被捕獲');
            } else {
                logger.error(`網路錯誤: ${error.message}`);
            }
        }

        // 示範 4: 重試機制
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                logger.info(`API 重試嘗試 ${retryCount + 1}/${maxRetries}...`);
                await axios.get('http://invalid-endpoint-for-retry-demo.com', {
                    timeout: 1000
                });
                break; // 成功則跳出循環
            } catch (error) {
                retryCount++;
                logger.warn(`重試 ${retryCount} 失敗: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    logger.error('達到最大重試次數，放棄請求');
                    logger.info('正確處理: 重試機制已執行完畢');
                } else {
                    // 指數退避延遲
                    const delay = Math.pow(2, retryCount) * 1000;
                    logger.info(`等待 ${delay}ms 後重試...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        logger.info('API 超時錯誤處理示範完成');
    }

    /**
     * 示範敏感資訊過濾
     */
    static demonstrateSensitiveInfoFiltering() {
        logger.info('開始示範敏感資訊過濾...');

        // 這些敏感資訊應該會被過濾
        const sensitiveMessages = [
            'API Token: abc123def456ghi789',
            'Password: mySecretPassword123',
            'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
            'api_key=sk-1234567890abcdef',
            'User email: user@example.com',
            'Credit card: 1234-5678-9012-3456',
            'Normal message without sensitive info'
        ];

        sensitiveMessages.forEach((message, index) => {
            logger.info(`測試訊息 ${index + 1}: ${message}`);
            
            // 檢查是否包含敏感資訊
            if (Logger.hasSensitiveInfo(message)) {
                logger.warn(`訊息 ${index + 1} 包含敏感資訊，已進行過濾`);
            } else {
                logger.info(`訊息 ${index + 1} 無敏感資訊`);
            }
        });

        logger.info('敏感資訊過濾示範完成');
    }

    /**
     * 示範未捕獲例外 (用於測試全域錯誤處理)
     * 注意: 這會觸發全域錯誤處理器
     */
    static demonstrateUncaughtException() {
        logger.warn('即將觸發未捕獲例外 (僅供測試用途)...');
        
        // 延遲執行，讓日誌有時間寫入
        setTimeout(() => {
            throw new Error('這是一個測試用的未捕獲例外');
        }, 100);
    }

    /**
     * 示範未處理的 Promise 拒絕
     */
    static demonstrateUnhandledRejection() {
        logger.warn('即將觸發未處理的 Promise 拒絕 (僅供測試用途)...');
        
        // 創建一個不會被處理的 Promise 拒絕
        setTimeout(() => {
            Promise.reject(new Error('這是一個測試用的未處理 Promise 拒絕'));
        }, 100);
    }

    /**
     * 運行所有示範
     */
    static async runAllDemonstrations() {
        logger.info('=== 開始錯誤處理示範 ===');
        
        try {
            await this.demonstrateIOErrors();
            await this.demonstrateAPITimeouts();
            this.demonstrateSensitiveInfoFiltering();
            
            logger.info('=== 所有示範完成 ===');
            logger.info('注意: 可以使用 demonstrateUncaughtException() 和 demonstrateUnhandledRejection() 測試全域錯誤處理');
            
        } catch (error) {
            logger.error(`示範過程中發生未預期錯誤: ${error.message}`);
            GlobalErrorHandler.logError(error, { module: 'ErrorDemoModule', method: 'runAllDemonstrations' });
        }
    }
}

module.exports = ErrorDemoModule;