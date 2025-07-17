// 取得策略模組
const strategies = require('./strategies');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

let strategy = null;


module.exports = {
    priority: 0,

    async updateStrategy() {
        logger.info('LlamaServerManager 更新策略中...');
        // 這裡可以根據需要更新策略，目前僅支援 local 策略
        strategy = strategies.local;
        this.priority = strategy.priority;
        logger.info('LlamaServerManager 策略更新完成');
    },

    async online(options) {
        if (!strategy) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategy.online(options);
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
    },
    
}
