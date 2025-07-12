const local = require('./strategies/local');
const remote = require('./strategies/remote');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

let strategies = null;

module.exports = {

    async updateStrategy() {
        logger.info('LlamaServerManager 更新策略中...');
        // 這裡可以根據需要更新策略
        // 目前僅支援 local 策略
        strategies = local;
        logger.info('LlamaServerManager 策略更新完成');
    },

    async online(options) {
        if (!strategies) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategies.online(options);
    },

    async offline() {
        if (!strategies) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategies.offline();
    },

    async restart(options) {
        if (!strategies) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategies.restart(options);
    },

    async state() {
        if (!strategies) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategies.state();
    },

    async send(options) {
        if (!strategies) {
            logger.warn('LlamaServerManager 尚未初始化，正在初始化...');
            await this.updateStrategy();
        }
        return await strategies.send(options);
    },
    
}