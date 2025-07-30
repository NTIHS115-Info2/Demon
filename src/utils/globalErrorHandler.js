const Logger = require('./logger');

let globalLogger = null;
let isInitialized = false;

/**
 * 全域錯誤處理器
 * 監控未捕獲的例外和Promise拒絕
 */
class GlobalErrorHandler {
    
    /**
     * 初始化全域錯誤處理
     * @param {Object} options - 配置選項
     * @param {string} options.logFileName - 錯誤日誌檔名，預設為 'global-errors.log'
     * @param {boolean} options.exitOnUncaught - 遇到未捕獲例外時是否退出程序，預設為 false
     */
    static init(options = {}) {
        if (isInitialized) {
            console.warn('[GlobalErrorHandler] 已經初始化過，忽略重複初始化');
            return;
        }

        const {
            logFileName = 'global-errors.log',
            exitOnUncaught = false
        } = options;

        globalLogger = new Logger(logFileName);
        isInitialized = true;

        // 監聽未捕獲的例外
        process.on('uncaughtException', (error) => {
            const errorInfo = {
                type: 'uncaughtException',
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                process: {
                    pid: process.pid,
                    version: process.version,
                    platform: process.platform
                }
            };

            globalLogger.error(`未捕獲例外: ${JSON.stringify(errorInfo, null, 2)}`);
            
            if (exitOnUncaught) {
                globalLogger.error('程序將因未捕獲例外而退出');
                process.exit(1);
            } else {
                globalLogger.warn('未捕獲例外已記錄，程序繼續運行');
            }
        });

        // 監聽未處理的Promise拒絕
        process.on('unhandledRejection', (reason, promise) => {
            const errorInfo = {
                type: 'unhandledRejection',
                reason: reason,
                promise: promise.toString(),
                timestamp: new Date().toISOString(),
                process: {
                    pid: process.pid,
                    version: process.version,
                    platform: process.platform
                }
            };

            globalLogger.error(`未處理的Promise拒絕: ${JSON.stringify(errorInfo, null, 2)}`);
            globalLogger.warn('建議檢查相關Promise是否缺少.catch()處理');
        });

        // 監聽警告事件
        process.on('warning', (warning) => {
            const warningInfo = {
                type: 'warning',
                name: warning.name,
                message: warning.message,
                stack: warning.stack,
                timestamp: new Date().toISOString()
            };

            globalLogger.warn(`程序警告: ${JSON.stringify(warningInfo, null, 2)}`);
        });

        globalLogger.info('全域錯誤處理器初始化完成');
        globalLogger.info(`配置: exitOnUncaught=${exitOnUncaught}, logFile=${logFileName}`);
    }

    /**
     * 手動記錄錯誤
     * @param {Error} error - 錯誤對象
     * @param {Object} context - 錯誤上下文信息
     */
    static logError(error, context = {}) {
        if (!isInitialized) {
            console.error('[GlobalErrorHandler] 尚未初始化，無法記錄錯誤');
            return;
        }

        const errorInfo = {
            type: 'manual',
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };

        globalLogger.error(`手動記錄錯誤: ${JSON.stringify(errorInfo, null, 2)}`);
    }

    /**
     * 包裝異步函數，自動捕獲錯誤
     * @param {Function} asyncFn - 異步函數
     * @param {Object} context - 錯誤上下文
     * @returns {Function} 包裝後的函數
     */
    static wrapAsync(asyncFn, context = {}) {
        return async (...args) => {
            try {
                return await asyncFn(...args);
            } catch (error) {
                GlobalErrorHandler.logError(error, {
                    ...context,
                    functionName: asyncFn.name,
                    arguments: args.length
                });
                throw error; // 重新拋出錯誤，讓調用方可以處理
            }
        };
    }

    /**
     * 檢查是否已初始化
     * @returns {boolean}
     */
    static isInitialized() {
        return isInitialized;
    }

    /**
     * 獲取全域錯誤日誌器
     * @returns {Logger|null}
     */
    static getLogger() {
        return globalLogger;
    }
}

module.exports = GlobalErrorHandler;