// 取得策略模組
const strategies = require('./strategies');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

let strategy = null;
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
        switch (newMode) {
            case 'remote':
                strategy = strategies.remote;
                break;
            case 'server':
                strategy = strategies.server;
                break;
            default:
                strategy = strategies.local;
        }
        logger.info(`LlamaServerManager 策略已切換為 ${mode}`);
        // 這裡可以根據需要更新策略，目前僅支援 local 策略
        this.priority = strategy.priority;
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
    },
    
}
