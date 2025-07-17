const local = require('./strategies/local');
const remote = require('./strategies/remote');
const server = require('./strategies/server');

const Logger = require('../../utils/logger');
const logger = new Logger('LlamaServerManager');

let strategies = null;
let mode = 'local';

module.exports = {

    /**
     * 更新策略模式
     * @param {'local'|'remote'|'server'} newMode
     */
    async updateStrategy(newMode = 'local') {
        logger.info('LlamaServerManager 更新策略中...');
        mode = newMode;
        switch (newMode) {
            case 'remote':
                strategies = remote;
                break;
            case 'server':
                strategies = server;
                break;
            default:
                strategies = local;
        }
        logger.info(`LlamaServerManager 策略已切換為 ${mode}`);
    },

    async online(options = {}) {
        const useMode = options.mode || mode;
        if (!strategies || useMode !== mode) {
            await this.updateStrategy(useMode);
        }
        return strategies.online(options);
    },

    async offline() {
        if (!strategies) {
            await this.updateStrategy(mode);
        }
        return strategies.offline();
    },

    async restart(options = {}) {
        const useMode = options.mode || mode;
        if (!strategies || useMode !== mode) {
            await this.updateStrategy(useMode);
        }
        return strategies.restart(options);
    },

    async state() {
        if (!strategies) {
            await this.updateStrategy(mode);
        }
        return strategies.state();
    },

    async send(options) {
        if (!strategies) {
            await this.updateStrategy(mode);
        }
        return strategies.send(options);
    },
    
}