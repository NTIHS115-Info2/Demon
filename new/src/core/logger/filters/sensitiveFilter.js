const MIN_MASK_LENGTH = 6;

const SENSITIVE_PATTERNS = [
  /token["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,
  /api[_-]?key["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,
  /password["\s]*[:=]["\s]*([^\s"]+)/gi,
  /secret["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,
  /authorization["\s]*:["\s]*([a-zA-Z0-9._-]+)/gi,
  /bearer\s+([a-zA-Z0-9._-]+)/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
];

function filterSensitiveInfo(message) {
  if (typeof message !== 'string') {
    message = String(message);
  }

  let filteredMessage = message;

  SENSITIVE_PATTERNS.forEach((pattern) => {
    filteredMessage = filteredMessage.replace(pattern, (match, sensitiveValue) => {
      if (sensitiveValue && typeof sensitiveValue === 'string') {
        const beforeSensitive = match.substring(0, match.indexOf(sensitiveValue));

        if (sensitiveValue.length <= MIN_MASK_LENGTH) {
          return beforeSensitive + '*'.repeat(sensitiveValue.length);
        }

        const visiblePart = sensitiveValue.substring(0, 3);
        const hiddenPart = '*'.repeat(sensitiveValue.length - 3);
        return beforeSensitive + visiblePart + hiddenPart;
      }

      if (match.length <= 6) {
        return '*'.repeat(match.length);
      }

      const visiblePart = match.substring(0, 3);
      const hiddenPart = '*'.repeat(match.length - 3);
      return visiblePart + hiddenPart;
    });
  });

  return filteredMessage;
}

function hasSensitiveInfo(message) {
  if (typeof message !== 'string') {
    message = String(message);
  }

  return SENSITIVE_PATTERNS.some((pattern) => {
    const flags = pattern.flags.replace(/g/g, '');
    const regex = new RegExp(pattern.source, flags);
    return regex.test(message);
  });
}

module.exports = {
  filterSensitiveInfo,
  hasSensitiveInfo,
  SENSITIVE_PATTERNS,
};
