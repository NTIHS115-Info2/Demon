const fileEditer = require('../tools/fileEditer');
const Logger = require('../core/logger');

const logger = new Logger('PromptComposer');

async function GetDefaultSystemPrompt() {
    return new Promise(async (resolve, reject) => {
        try {
            const DefaultSystemPrompt = await fileEditer.GetFilesContent(__dirname + '/soulPresets');

            let result = "";

            DefaultSystemPrompt.forEach(element => {
                result += element + "\n";
            });

            logger.info(`成功讀取預設系統提示：${DefaultSystemPrompt.length} 個提示`);
            logger.info(`預設系統提示內容：\n${result}`);
            resolve(result);
        } catch (error) {
            logger.error(`讀取預設系統提示失敗：${error.message}`);
            reject(error);
        }
    });

}

module.exports.GetDefaultSystemPrompt = GetDefaultSystemPrompt;