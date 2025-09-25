const Logger = require('../../utils/logger');
const localStrategy = require('./strategies/local/index.js');
// 註：strategies/index.js 檔案在此架構下是多餘的，可以刪除

const logger = new Logger('news_scraper_plugin.log');
let currentStrategy = null;

module.exports = {
    /**
     * 更新並初始化策略。
     * @param {object} options - 包含 strategy 名稱等選項
     */
    async updateStrategy(options = {}) {
        const strategyName = options.strategy || 'local';
        logger.info(`Updating strategy to '${strategyName}'...`);
        
        const newStrategy = strategyName === 'local' ? localStrategy : null; // 可擴充以支持 'remote' 等
        
        if (!newStrategy) {
            throw new Error(`Strategy '${strategyName}' not found.`);
        }

        // 如果當前有策略且不是新策略，則先將其下線
        if (currentStrategy && currentStrategy !== newStrategy) {
            await currentStrategy.offline();
        }

        currentStrategy = newStrategy;
        
        // 如果插件處於在線狀態，則自動讓新策略上線
        if (currentStrategy.isOnline) {
             await currentStrategy.online(options);
        }
        logger.info(`Strategy successfully updated to '${strategyName}'.`);
    },

    /**
     * 讓當前策略上線
     */
    async online(options = {}) {
        if (!currentStrategy) {
            await this.updateStrategy(options);
        }
        await currentStrategy.online(options);
    },

    /**
     * 讓當前策略下線
     */
    async offline() {
        if (currentStrategy) {
            await currentStrategy.offline();
        }
    },

    /**
     * 重啟當前策略
     */
    async restart(options = {}) {
        if (currentStrategy) {
            await currentStrategy.offline();
            await new Promise(resolve => setTimeout(resolve, 100));
            await currentStrategy.online(options);
        } else {
            // 如果沒有當前策略，重啟等同於上線
            await this.online(options);
        }
    },

    /**
     * 獲取當前策略的狀態
     */
    async state() {
        if (currentStrategy) {
            return currentStrategy.state();
        }
        return 0; // 預設為離線
    },

    /**
     * 將請求委派給當前策略的 send 方法
     */
    async send(payload) {
        if (!currentStrategy) {
            return { success: false, error: 'Plugin not initialized. Please call online() or updateStrategy() first.' };
        }
        return currentStrategy.send(payload);
    }
};