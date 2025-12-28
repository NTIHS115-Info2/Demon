function format(level, message, timestamp = null) {
  const ts = timestamp || new Date().toISOString();
  return `${ts} - ${String(level).toUpperCase()} - ${String(message)}`;
}

module.exports = { format };
