const math = require('mathjs');

// 進階運算，提供次方、平方根與三角函數等
module.exports = {
  pow(base, exponent) {
    return math.pow(base, exponent);
  },

  sqrt(value) {
    if (value < 0) throw new Error('無法對負數取平方根');
    return math.sqrt(value);
  },

  sin(value) {
    return math.sin(value);
  },

  cos(value) {
    return math.cos(value);
  },

  tan(value) {
    return math.tan(value);
  }
};
