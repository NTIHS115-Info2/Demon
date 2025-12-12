// src/plugins/newsScraper/index.js
// 職責：作為一個輕薄的轉發層，不包含任何業務邏輯。
const Logger = require('../../utils/logger');
const strategies = require('./strategies');

const logger = new Logger('newsScraper_plugin.log');
let currentStrategy = null;
let currentStrategyName = '';

module.exports = {
    async updateStrategy(options = {}) {
        const strategyName = options.strategy || 'local';
        if (!strategies[strategyName]) {
            throw new Error(`Strategy '${strategyName}' not found.`);
        }

        if (currentStrategy && currentStrategyName !== strategyName) {
            await currentStrategy.offline();
        }

        currentStrategy = strategies[strategyName];
        currentStrategyName = strategyName;
        logger.info(`Strategy successfully set to '${strategyName}'.`);
    },

    async online(options = {}) {
        if (!currentStrategy) {
            await this.updateStrategy(options);
        }
        return await currentStrategy.online(options);
    },

    async offline() {
        if (!currentStrategy) return;
        return await currentStrategy.offline();
    },

    async restart(options = {}) {
        if (!currentStrategy) {
            return await this.online(options);
        }
        return await currentStrategy.restart(options);
    },

    async state() {
        if (!currentStrategy) return 0; // 預設為離線
        return await currentStrategy.state();
    },

    async send(payload) {
        if (!currentStrategy) {
            return { success: false, error: 'Plugin not initialized. Please call online() first.' };
        }
        return await currentStrategy.send(payload);
    }
};
