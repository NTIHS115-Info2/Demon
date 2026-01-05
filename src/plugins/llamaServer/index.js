// 取得策略模組
const fs = require('fs');
const path = require('path');
const strategies = require('./strategies');
const serverInfo = require('./strategies/server/infor');
const OsInfor = require('../../tools/OsInfor');
const configManager = require('../../utils/configManager');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

// 目前使用中的策略，預設採用 remote
let strategy = strategies.remote;
let mode = 'remote';
const defaultWeights = { remote: 3, server: 2, local: 1 };
let weights = { ...defaultWeights };

// 設定檔路徑與驗證規格（優先序：options > env > config）
const LLAMA_CONFIG_PATH = path.resolve(__dirname, '../../../config/llamaServer.js');
const LLAMA_CONFIG_SCHEMA = {
    types: {
        mode: 'string',
        base_url: 'string',
        baseUrl: 'string',
        model: 'string',
        timeout: 'number',
        req_id: 'string',
        reqId: 'string'
    }
};

// 讀取 LlamaServer 設定檔，若不存在則回傳空物件
const loadLlamaConfig = () => {
    try {
        if (!fs.existsSync(LLAMA_CONFIG_PATH)) {
            return {};
        }
        return configManager.loadAndValidate(LLAMA_CONFIG_PATH, LLAMA_CONFIG_SCHEMA, 'LlamaServer');
    } catch (error) {
        logger.error(`讀取 LlamaServer 設定檔失敗: ${error.message}`);
        throw error;
    }
};

// 解析模式來源，並確保 auto 預設採用 remote
const resolveMode = (options = {}, config = {}) => {
    const envMode = process.env.LLAMA_MODE || process.env.LLAMA_SERVER_MODE;
    const resolvedMode = options.mode || envMode || config.mode || 'auto';
    return resolvedMode === 'auto' ? 'remote' : resolvedMode;
};

// 解析遠端設定來源，統一輸出供策略使用
const resolveRemoteOptions = (options = {}, config = {}) => {
    return {
        baseUrl: options.baseUrl || options.base_url || process.env.LLAMA_REMOTE_BASE_URL || config.baseUrl || config.base_url,
        model: options.model || process.env.LLAMA_REMOTE_MODEL || config.model,
        timeout: options.timeout || process.env.LLAMA_REMOTE_TIMEOUT || config.timeout,
        req_id: options.reqId || options.req_id || process.env.LLAMA_REMOTE_REQ_ID || config.reqId || config.req_id
    };
};

module.exports = {

    /**
     * 更新策略模式
     * @param {'local'|'remote'|'server'} newMode
     */
    async updateStrategy(newMode = 'auto', options = {}) {
        logger.info('LlamaServerManager 更新策略中...');

        try {
            // 如果已有策略在運行，先清理資源
            if (strategy && mode !== newMode) {
                try {
                    const currentState = await strategy.state();
                    if (currentState === 1) {
                        logger.info(`正在關閉當前策略 ${mode} 以切換至 ${newMode}`);
                        await strategy.offline();
                    }
                } catch (error) {
                    logger.warn(`清理前一個策略時發生錯誤: ${error.message}`);
                }
            }

            // 依據解析後模式切換策略，確保 auto 時走 remote
            mode = newMode === 'auto' ? 'remote' : newMode;
            switch (mode) {
                case 'remote':
                    strategy = strategies.remote;
                    break;
                case 'server':
                    strategy = strategies.server;
                    break;
                default:
                    strategy = strategies.local;
                    mode = 'local'; // 確保模式正確設定
            }
            logger.info(`LlamaServerManager 策略已切換為 ${mode}`);
            this.priority = strategy.priority;
        } catch (error) {
            logger.error(`LlamaServerManager 更新策略失敗: ${error.message}`);
            throw error;
        }
    },

    async online(options = {}) {
        try {
            // 整合設定來源並取得模式與遠端參數
            const config = loadLlamaConfig();
            const useMode = resolveMode(options, config);
            const remoteOptions = resolveRemoteOptions(options, config);
            const mergedOptions = { ...options, ...remoteOptions, mode: useMode };
            if (!strategy || useMode !== mode) {
                await this.updateStrategy(useMode, mergedOptions);
            }
            const result = await strategy.online(mergedOptions);
            logger.info(`LlamaServerManager ${mode} 模式已成功啟動`);
            return result;
        } catch (error) {
            logger.error(`LlamaServerManager ${mode} 模式啟動失敗: ${error.message}`);
            throw error;
        }
    },

    async offline() {
        try {
            if (!strategy) {
                logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
                await this.updateStrategy();
            }
            const result = await strategy.offline();
            logger.info(`LlamaServerManager ${mode} 模式已關閉`);
            return result;
        } catch (error) {
            logger.error(`LlamaServerManager ${mode} 模式關閉失敗: ${error.message}`);
            throw error;
        }
    },

    async restart(options = {}) {
        try {
            if (!strategy) {
                logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
                await this.updateStrategy();
            }
            const result = await strategy.restart(options);
            logger.info(`LlamaServerManager ${mode} 模式已重新啟動`);
            return result;
        } catch (error) {
            logger.error(`LlamaServerManager ${mode} 模式重新啟動失敗: ${error.message}`);
            throw error;
        }
    },

    async state() {
        try {
            if (!strategy) {
                logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
                await this.updateStrategy();
            }
            return await strategy.state();
        } catch (error) {
            logger.error(`LlamaServerManager ${mode} 模式狀態查詢失敗: ${error.message}`);
            return -1;
        }
    },

    async send(options) {
        try {
            if (!strategy) {
                logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
                await this.updateStrategy();
            }
            return await strategy.send(options);
        } catch (error) {
            logger.error(`LlamaServerManager ${mode} 模式發送失敗: ${error.message}`);
            throw error;
        }
    }

};
