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

    priority: 0,

    /**
     * 更新策略模式
     * @param {'local'|'remote'|'server'} newMode
     */
    async updateStrategy(newMode = 'auto', options = {}) {
        logger.info('LlamaServerManager 更新策略中...');
        weights = { ...weights, ...(options.weights || {}) };

        if (newMode !== 'auto') {
            mode = newMode;
            strategy = strategies[newMode] || strategies.local;
            this.priority = strategy.priority;
            logger.info(`LlamaServerManager 策略已切換為 ${mode}`);
            return;
        }

        const order = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);

        for (const m of order) {
            if (m === 'remote') {
                if (options.baseUrl) {
                    try {
                        await axios.get(options.baseUrl, { timeout: 1000 });
                        mode = 'remote';
                        strategy = strategies.remote;
                        this.priority = strategy.priority;
                        logger.info('LlamaServerManager 自動選擇 remote 策略');
                        return;
                    } catch (e) {
                        logger.warn('remote 無法連線: ' + e.message);
                    }
                }
            } else if (m === 'server') {
                try {
                    const info = await OsInfor.table();
                    const ok = Object.entries(serverInfo.serverInfo || {}).every(([k, v]) => info[k] === v);
                    if (ok) {
                        mode = 'server';
                        strategy = strategies.server;
                        this.priority = strategy.priority;
                        logger.info('LlamaServerManager 自動選擇 server 策略');
                        return;
                    }
                } catch (e) {
                    logger.warn('server 判定失敗: ' + e.message);
                }
            } else if (m === 'local') {
                mode = 'local';
                strategy = strategies.local;
                this.priority = strategy.priority;
                logger.info('LlamaServerManager 自動選擇 local 策略');
                return;
            }
        }

        mode = 'local';
        strategy = strategies.local;
        this.priority = strategy.priority;
        logger.info('LlamaServerManager 自動選擇預設 local 策略');
    },

    async online(options = {}) {
        const useMode = options.mode || mode;
        if (!strategy || useMode !== mode) {
            await this.updateStrategy(useMode, options);
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
