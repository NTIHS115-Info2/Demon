const fs = require('fs');
const path = require('path');
const Logger = require('../../utils/logger');
const logger = new Logger('ToolReference');

let descriptionCache = null;

function readDescriptions(rootPath) {
  const result = {};
  const dirs = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(rootPath, dir.name, 'tool-description.json');
    if (fs.existsSync(file)) {
      try {
        result[dir.name] = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        logger.warn(`讀取 ${dir.name} tool-description 失敗: ${e.message}`);
      }
    }
  }
  return result;
}

module.exports = {
  pluginName: 'toolReference',
  pluginType: 'TOOL',
  priority: 0,
  async updateStrategy() {},
  async online() {
    const pluginsPath = path.resolve(__dirname, '..');
    descriptionCache = readDescriptions(pluginsPath);
    logger.info('ToolReference 已載入工具說明');
  },
  async offline() {
    descriptionCache = null;
  },
  async restart() {
    await this.offline();
    await this.online();
  },
  async state() {
    return 1;
  },
  /**
   * 取得所有工具的說明資料摘要
   */
  async send() {
    try {
      if (!descriptionCache) {
        const pluginsPath = path.resolve(__dirname, '..');
        descriptionCache = readDescriptions(pluginsPath);
      }
      const categories = {};
      for (const key of Object.keys(descriptionCache)) {
        const info = descriptionCache[key];
        const cat = info.category || '其他';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(`「${info.name}」：${info.description}`);
      }
      let summary = '';
      for (const cat of Object.keys(categories)) {
        summary += `### ${cat}\n`;
        categories[cat].forEach(item => {
          summary += `- ${item}\n`;
        });
      }
      return summary.trim();
    } catch (e) {
      logger.error(`產生工具摘要失敗: ${e.message}`);
      return '';
    }
  }
};
