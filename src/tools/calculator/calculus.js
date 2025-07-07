const math = require('mathjs');

// 數值積分：使用 Simpson 法近似
function integrate(expr, variable, a, b, n = 1000) {
  const compiled = math.compile(expr);
  const h = (b - a) / n;
  let sum = compiled.evaluate({ [variable]: a }) + compiled.evaluate({ [variable]: b });
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    const weight = i % 2 === 0 ? 2 : 4;
    sum += weight * compiled.evaluate({ [variable]: x });
  }
  return (h / 3) * sum;
}

// 數值極限：從左右逼近
function limit(expr, variable, value, epsilon = 1e-7) {
  const compiled = math.compile(expr);
  const left = compiled.evaluate({ [variable]: value - epsilon });
  const right = compiled.evaluate({ [variable]: value + epsilon });
  if (Math.abs(left - right) < 1e-6) return (left + right) / 2;
  throw new Error('左右極限不相等');
}

module.exports = {
  derivative(expr, variable) {
    return math.derivative(expr, variable).toString();
  },

  integrate,
  limit
};
