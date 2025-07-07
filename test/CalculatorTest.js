const { evaluateNaturalLanguage, naturalLanguageToSymbol } = require('../src/tools/calculator');
const Logger = require('../src/core/logger');

const logger = new Logger('calculator-test.log');

(async () => {
  try {
  logger.info('自然語言加法測試: 2 加 3');
  const a = evaluateNaturalLanguage('2 加 3');
  logger.info(`結果: ${a}`);
  logger.info('符號表示: ' + naturalLanguageToSymbol('2 加 3'));

  logger.info('自然語言微分測試: 微分 x^2 對 x');
  const d = evaluateNaturalLanguage('微分 x^2 對 x');
  logger.info(`結果: ${d}`);
  logger.info('符號表示: ' + naturalLanguageToSymbol('微分 x^2 對 x'));

  logger.info('自然語言積分測試: 積分 sin(x) 對 x 從 0 到 3.14159');
  const i = evaluateNaturalLanguage('積分 sin(x) 對 x 從 0 到 3.14159');
  logger.info(`結果: ${i}`);
  logger.info('符號表示: ' + naturalLanguageToSymbol('積分 sin(x) 對 x 從 0 到 3.14159'));

  logger.info('自然語言極限測試: 極限 sin(x)/x 當 x 趨近 0');
  const l = evaluateNaturalLanguage('極限 sin(x)/x 當 x 趨近 0');
  logger.info(`結果: ${l}`);
  logger.info('符號表示: ' + naturalLanguageToSymbol('極限 sin(x)/x 當 x 趨近 0'));
  } catch (err) {
    logger.error('測試失敗', err);
  }
})();
