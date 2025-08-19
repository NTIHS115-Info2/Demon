// jest.config.js
module.exports = {
  testPathIgnorePatterns: [
    "<rootDir>/__test__/pass/.*\\.js$",
    "<rootDir>/__test__/Archive/.*\\.js$",
    "<rootDir>/__test__/localPass/.*\\.js$",
    "<rootDir>/__test__/\\._.*\\.test\\.js$"
  ]
};