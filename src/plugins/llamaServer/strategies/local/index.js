const axios = require('axios');
const EventEmitter = require('events');

const LlamaServerManager = require('../../../../../Server/llama/llamaServer');
const Logger = require('../../../../utils/logger');

const logger = new Logger('LlamaServerManager');

let llamaServerManager = null;

// 此策略的預設啟動優先度
const priority = 50;

module.exports = {
    priority,

    async online(options) {
        logger.info('LlamaServerManager 正在啟動中...');
        
        // 如果已有實例在運行，先檢查其狀態
        if (llamaServerManager) {
            if (llamaServerManager.isRunning()) {
                logger.warn('LlamaServerManager 已經在運行中，正在重新啟動...');
                await llamaServerManager.restartWithPreset(options.preset || 'exclusive');
                return true;
            } else {
                // 清理無效的實例
                llamaServerManager = null;
            }
        }

        // 創建新的管理器實例
        llamaServerManager = new LlamaServerManager();

        try {
            const result = await llamaServerManager.startWithPreset(options.preset || 'exclusive');
            logger.info(`LlamaServerManager 已啟動，使用：${options.preset || 'exclusive'} 模式`);
            return result;
        } catch (error) {
            logger.error(`LlamaServerManager 啟動失敗: ${error.message}`);
            llamaServerManager = null; // 清理失敗的實例
            throw error;
        }
    },

    async offline() {
        logger.info('LlamaServerManager 正在關閉中...');

        if (!llamaServerManager || !llamaServerManager.isRunning()) {
            logger.warn('LlamaServerManager 尚未啟動或已經關閉');
            // 確保變數被重置
            llamaServerManager = null;
            return true;
        }

        try {
            const result = await llamaServerManager.stop();
            logger.info('LlamaServerManager 已關閉');
            
            // 重置管理器實例以釋放資源
            llamaServerManager = null;
            
            return result;
        } catch (error) {
            logger.error(`LlamaServerManager 關閉時發生錯誤: ${error.message}`);
            // 即使發生錯誤也要重置變數
            llamaServerManager = null;
            throw error;
        }
    },

    async restart(options) {
        logger.info('LlamaServerManager 正在重新啟動...');
        
        try {
            await this.offline();
            
            // 等待資源釋放，使用更長的延遲確保穩定性
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return await this.online(options);
        } catch (error) {
            logger.error(`LlamaServerManager 重新啟動失敗: ${error.message}`);
            throw error;
        }
    },

    /** 0為下線 1為上線 -1為錯誤 */
    async state() {
        if (!llamaServerManager) {
            logger.warn('LlamaServerManager 尚未初始化');
            return 0;
        }

        if (llamaServerManager.isRunning()) {
            logger.info('LlamaServerManager 正在運行中');
            return 1;
        } else {
            logger.warn('LlamaServerManager 已停止或未正確啟動');
            return -1;
        }
    },

    async send(options) {
        const emitter = new EventEmitter();
        let stream = null;
        let aborted = false;

        const url = 'http://localhost:8011/v1/chat/completions';
        const payload = {
            messages: options || [],
            stream: true,
        };

        axios({
            url,
            method: 'POST',
            data: payload,
            responseType: 'stream',
            headers: {
                'Content-Type': 'application/json',
            }
        }).then(res => {
            if (aborted) {
                res.data.destroy(); // 如果已被中止，立刻銷毀
                return;
            }

            stream = res.data;  // 記住 stream 以供 abort 用

            let buffer = '';
            stream.on('data', chunk => {
                buffer += chunk.toString();

                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const content = line.replace('data: ', '').trim();
                        if (content === '[DONE]') {
                            emitter.emit('end');
                            return;
                        }
                        try {
                            const json = JSON.parse(content);
                            const text = json.choices?.[0]?.delta?.content || json.content || '';
                            emitter.emit('data', text, json);
                        } catch (e) {
                            emitter.emit('error', e);
                        }
                    }
                }
            });

            stream.on('end', () => emitter.emit('end'));
            stream.on('error', err => emitter.emit('error', err));
        }).catch(err => {
            if (!aborted) emitter.emit('error', err);
        });

        // 🔥 關鍵：加上中斷方法
        emitter.abort = () => {
            aborted = true;
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy(); // 強制終止 stream
                emitter.emit('abort');
            }
        };

        return emitter;
    }

}