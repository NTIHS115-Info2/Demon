const path = require('path');

const GetFileContent = require('../src/tools/fileReader').GetFileContent;
const GetFilesContent = require('../src/tools/fileReader').GetFilesContent;

const Logger = require('../src/core/logger');

const logger = new Logger('systemPromptTest');

(async () => {
  try {
    const dirPath = path.join(__dirname, '../src/core/soulPresets');
    const contents = await GetFilesContent(dirPath);
    
    contents.forEach((content, index) => {
      logger.info(`--- File ${index + 1} ---`);
      logger.info(content);
    });
  } catch (error) {
    logger.error('Error reading directory:', error);
  }
})();

(async () => {
  try {
    const filePath = path.join(__dirname, '../src/core/soulPresets/soul');
    const content = await GetFileContent(filePath);

    logger.info(`--- File Content ---`);
    logger.info(content);
  } catch (error) {
    logger.error('Error reading file:', error);
  }
})();