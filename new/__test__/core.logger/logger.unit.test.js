const { filterSensitiveInfo, hasSensitiveInfo } = require('../../src/core/logger/filters/sensitiveFilter');
const LineFormatter = require('../../src/core/logger/formatters/LineFormatter');
const RawFormatter = require('../../src/core/logger/formatters/RawFormatter');

test('filterSensitiveInfo masks values and preserves first 3 chars', () => {
  const tokenInput = 'token=abcdefghi';
  expect(filterSensitiveInfo(tokenInput)).toBe('token=abc******');

  const passwordInput = 'password=abc';
  expect(filterSensitiveInfo(passwordInput)).toBe('password=***');

  const email = 'user@example.com';
  const emailInput = `contact ${email} now`;
  const maskedEmail = filterSensitiveInfo(emailInput);
  const expectedMaskedEmail = `contact ${email.slice(0, 3)}${'*'.repeat(email.length - 3)} now`;
  expect(maskedEmail).toBe(expectedMaskedEmail);
});

test('hasSensitiveInfo is stable across repeated calls', () => {
  const input = 'token=abcdefghi';
  expect(hasSensitiveInfo(input)).toBe(true);
  expect(hasSensitiveInfo(input)).toBe(true);
  expect(hasSensitiveInfo('no secrets here')).toBe(false);
});

test('LineFormatter/RawFormatter honor provided timestamp', () => {
  const ts = '2025-01-02T03:04:05.678Z';
  const line = LineFormatter.format('info', 'hello', ts);
  expect(line).toBe('2025-01-02T03:04:05.678Z - INFO - hello');

  const raw = RawFormatter.format('warn', 'ping', ts);
  expect(raw).toBe('2025-01-02T03:04:05.678Z - WARN - RAW - ping');
});
