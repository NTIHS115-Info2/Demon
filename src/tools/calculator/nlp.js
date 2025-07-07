// 無需額外套件即可進行簡易的自然語言解析
// 主要將常見的中文與英文敘述轉為標準數學運算式
function parseNaturalLanguage(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('輸入必須為非空字串');
  }

  // 去除前後空白，方便後續比對
  const str = text.trim();

  let match;

  // 微分：支援「微分 x^2 對 x」、「求導 x^2 針對 x」等寫法
  match = str.match(/(?:微分|求導)\s*(.+)\s*(?:對|針對)\s*(\w+)/i);
  if (!match) {
    match = str.match(/derivative\s+of\s+(.+)\s+with\s+respect\s+to\s+(\w+)/i);
  }
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    return `derivative(${expr},${variable})`;
  }

  // 積分：支援「積分 sin(x) 對 x 從 0 到 1」或英文類似敘述
  match = str.match(/(?:積分|求積)\s*(.+)\s*(?:對|關於)\s*(\w+)\s*(?:從|由)\s*(.+)\s*(?:到|至)\s*(.+)/i);
  if (!match) {
    match = str.match(/integrate\s*(.+)\s*with\s*respect\s*to\s*(\w+)\s*from\s*(.+)\s*to\s*(.+)/i);
  }
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const a = match[3].trim();
    const b = match[4].trim();
    return `integrate(${expr},${variable},${a},${b})`;
  }

  // 極限：處理中英文各種表達
  match = str.match(/(?:極限|limit)\s*(.+)\s*(?:當|as)\s*(\w+)\s*(?:趨近|approaches?)\s*(.+)/i);
  if (match) {
    const expr = match[1].trim();
    const variable = match[2].trim();
    const value = match[3].trim();
    return `limit(${expr},${variable},${value})`;
  }

  // 加減乘除與其他基本運算
  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:plus|加|加上|和|與)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `${match[1]} + ${match[2]}`;

  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:minus|減|減去)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `${match[1]} - ${match[2]}`;

  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:times|乘|乘以|乘上|multiplied by)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `${match[1]} * ${match[2]}`;

  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:divided by|除以|除|比)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `${match[1]} / ${match[2]}`;

  // 平方根：支援「square root of 4」、「4 的平方根」、「開根號 4」
  match = str.match(/(?:square root of|平方根|開根號)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `sqrt(${match[1]})`;

  // 次方：例如「2 的 3 次方」、「2 raised to the power of 3」、「2 的平方」
  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:raised to the power of|的?\s*次方)\s*(-?\d+(?:\.\d+)?)/i);
  if (match) return `pow(${match[1]},${match[2]})`;
  match = str.match(/(-?\d+(?:\.\d+)?)\s*(?:的)?\s*平方/i);
  if (match) return `pow(${match[1]},2)`;

  // 無法解析時，直接回傳原文字串（交由 math.js 處理）
  return str;
}

module.exports = { parseNaturalLanguage };
