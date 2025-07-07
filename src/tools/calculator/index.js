const arithmetic = require('./arithmetic');
const advanced = require('./advanced');
const calculus = require('./calculus');
const { parseNaturalLanguage } = require('./nlp');
const { formatExpression } = require('./formatter');
const math = require('mathjs');

// 利用正規表示式解析特殊函式呼叫
function evaluateExpression(expression) {
  if (typeof expression !== 'string') throw new Error('運算式必須為字串');

  // derivative(expr, variable)
  let match = expression.match(/^derivative\((.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    return calculus.derivative(expr, variable);
  }

  // integrate(expr, variable, a, b)
  match = expression.match(/^integrate\((.*),(.*),(.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const a = parseFloat(match[3]);
    const b = parseFloat(match[4]);
    if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('積分上下限必須為數字');
    return calculus.integrate(expr, variable, a, b);
  }

  // limit(expr, variable, value)
  match = expression.match(/^limit\((.*),(.*),(.*)\)$/);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const value = parseFloat(match[3]);
    if (Number.isNaN(value)) throw new Error('極限值必須為數字');
    return calculus.limit(expr, variable, value);
  }

  // 其他直接交給 mathjs evaluate
  return math.evaluate(expression);
}

// 解析自然語言並計算結果
function evaluateNaturalLanguage(text) {
  const expr = parseNaturalLanguage(text);
  return evaluateExpression(expr);
}

// 解析自然語言後轉為通用符號表示，方便 LLM 取得結構化運算式
function naturalLanguageToSymbol(text) {
  const expr = parseNaturalLanguage(text);
  return formatExpression(expr);
}

module.exports = {
  ...arithmetic,
  ...advanced,
  ...calculus,
  evaluateExpression,
  evaluateNaturalLanguage,
  formatExpression,
  naturalLanguageToSymbol
};
