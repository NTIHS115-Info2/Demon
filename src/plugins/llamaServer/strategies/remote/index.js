// 等遠端實作建立完成後，再完成這邊

module.exports = {
    async online(options) {},
    async offline() {},
    async restart(options) {},
    async state() {},
    async send(options) {
        throw new Error('遠端 llama 尚未實作');
    },
}