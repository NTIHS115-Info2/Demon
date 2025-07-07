const math = require('mathjs');

/**
 * 將運算式轉換為通用符號表示，方便文字或 LLMS 使用
 * 會嘗試解析 derivative、integrate、limit 等特殊函式
 * 其餘則交由 math.js 解析並以 toString 輸出
 * @param {string} expression
 * @returns {string} 轉換後的符號字串
 */
function formatExpression(expression) {
  if (typeof expression !== 'string') {
    throw new Error('運算式必須為字串');
  }

  let match;

  // derivative(expr, variable)
  match = expression.match(/^derivative\((.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    return `d/d${variable} (${expr})`;
  }

  // integrate(expr, variable, a, b)
  match = expression.match(/^integrate\((.*),(.*),(.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const a = match[3].trim();
    const b = match[4].trim();
    return `∫_${a}^${b} ${expr} d${variable}`;
  }

  // limit(expr, variable, value)
  match = expression.match(/^limit\((.*),(.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const value = match[3].trim();
    return `lim_{${variable}->${value}} ${expr}`;
  }

  try {
    const node = math.parse(expression);
    return node.toString();
  } catch (err) {
    throw new Error('無法解析運算式');
  }
}

module.exports = { formatExpression };
