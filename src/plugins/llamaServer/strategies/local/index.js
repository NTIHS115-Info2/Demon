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
        
        if (llamaServerManager) {
            logger.warn('LlamaServerManager 已經存在，正在重新啟動...');
            await llamaServerManager.restartWithPreset(options.preset || 'exclusive');
            return;
        }

        llamaServerManager = new LlamaServerManager();

        const result = await llamaServerManager.startWithPreset(options.preset || 'exclusive');

        logger.info(`LlamaServerManager 已啟動，使用：${options.preset || 'exclusive'} 模式`);

        return result; // 返回啟動結果，可能是 Promise 或其他值
    },

    async offline() {

        logger.info('LlamaServerManager 正在關閉中...');

        if (!llamaServerManager || !llamaServerManager.isRunning()) {
            logger.warn('LlamaServerManager 尚未啟動或已經關閉');
            return;
        }

        const result = await llamaServerManager.stop();
        logger.info('LlamaServerManager 已關閉');

        return result

    },

    async restart(options) {
        logger.info('LlamaServerManager 正在重新啟動...');
        await this.offline();
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.online(options);
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