const math = require('mathjs');

// 基本運算功能，提供加減乘除
module.exports = {
  add(a, b) {
    return math.add(a, b);
  },

  subtract(a, b) {
    return math.subtract(a, b);
  },

  multiply(a, b) {
    return math.multiply(a, b);
  },

  divide(a, b) {
    if (b === 0) throw new Error('除數不可為 0');
    return math.divide(a, b);
  }
};
