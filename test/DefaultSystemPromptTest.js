const GetDefaultSystemPrompt = require('../src/core/PromptComposer').GetDefaultSystemPrompt;

const Logger = require('../src/core/logger');
const logger = new Logger('systemPromptTest');

(async () => {
  try {
    const contents = await GetDefaultSystemPrompt();

    logger.info('--- System Prompts ---');
    logger.info(contents);

  } catch (error) {
    logger.error('Error reading system prompts:', error);
  }
})();