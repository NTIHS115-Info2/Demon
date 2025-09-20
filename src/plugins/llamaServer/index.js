// 取得策略模組
const axios = require('axios');
const strategies = require('./strategies');
const serverInfo = require('./strategies/server/infor');
const OsInfor = require('../../tools/OsInfor');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

// 目前使用中的策略，預設採用 local
let strategy = strategies.local;
let mode = 'local';
const defaultWeights = { remote: 3, server: 2, local: 1 };
let weights = { ...defaultWeights };


module.exports = {

    /**
     * 更新策略模式
     * @param {'local'|'remote'|'server'} newMode
     */
    async updateStrategy(newMode = 'auto', options = {}) {
        logger.info('LlamaServerManager 更新策略中...');
        
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
        
        mode = newMode;
        switch (newMode) {
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
    },

    async online(options = {}) {
        try {
            const useMode = options.mode || mode;
            if (!strategy || useMode !== mode) {
                await this.updateStrategy(useMode, options);
            }
            const result = await strategy.online(options);
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
