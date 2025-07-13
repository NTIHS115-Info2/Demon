const pluginsManager    = require("./src/core/pluginsManager");
const Logger            = require("./src/utils/logger");

const logger            = new Logger('mainScripts.log');

(async()=>{

    logger.info("開始啟動...");
    logger.info("正在初始化pluginsManager");

    await pluginsManager.loadAllPlugins();
    await pluginsManager.queueAllOnline();

    logger.info("pluginsManager 啟動完畢");

})()