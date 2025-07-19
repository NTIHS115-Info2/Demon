// 取得策略模組
const strategies = require('./strategies');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

// 目前使用中的策略，預設採用 local
let strategy = strategies.local;
let mode = 'local';


module.exports = {

    priority: 0,

    /**
     * 更新策略模式
     * @param {'local'|'remote'|'server'} newMode
     */
    async updateStrategy(newMode = 'local') {
        logger.info('LlamaServerManager 更新策略中...');
        mode = newMode;
        // 依傳入模式選擇對應策略，預設為 local
        strategy = strategies[newMode] || strategies.local;
        this.priority = strategy.priority;
        logger.info(`LlamaServerManager 策略已切換為 ${mode}`);
        logger.info('LlamaServerManager 策略更新完成');
    },

    async online(options = {}) {
        const useMode = options.mode || mode;
        if (!strategy || useMode !== mode) {
            await this.updateStrategy(useMode);
        }
        return strategy.online(options);
    },

    async offline() {
        if (!strategy) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategy.offline();
    },

    async restart(options) {
        if (!strategy) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategy.restart(options);
    },

    async state() {
        if (!strategy) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategy.state();
    },

    async send(options) {
        if (!strategy) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategy.send(options);
    }

};
