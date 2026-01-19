#!/usr/bin/env node
/**
 * Interactive WebSocket console client for AppChatService.
 */

const WebSocket = require('ws');
const readline = require('readline');
const crypto = require('crypto');

function newRequestId() {
  return crypto.randomBytes(12).toString('hex');
}

const url = process.argv[2] || 'ws://127.0.0.1:80/ios-app/chat/ws';
const username = process.argv[3] || 'ConsoleUser';

if (!url) {
  console.error('Usage: node ws_console_client.js <ws_url> [username]');
  process.exit(1);
}

let rawMode = false;
let activeRequestId = null;
let inputLocked = false;

// streaming render state
let streamingChannel = null; // 'think' | 'talk' | null
let printedPrefixForChannel = false;
let lastStatusKey = null;
let lastRoundEndKey = null;
const lastStreamChar = { think: '', talk: '' };

// readline (only used when unlocked)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

// Keypress suppression while locked (prevents user typing being echoed / wiped)
let keypressListener = null;
readline.emitKeypressEvents(process.stdin);

function lockInput(lock) {
  if (lock === inputLocked) return;
  inputLocked = lock;

  if (lock) {
    // stop line mode
    rl.pause();

    // Enter raw mode to avoid terminal echo + line editing conflicts
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(true); } catch {}
    }

    // swallow all keypresses (allow Ctrl+C / Ctrl+D)
    keypressListener = (str, key) => {
      if (key && key.ctrl && key.name === 'c') {
        process.stdout.write('\n^C\n');
        process.exit(0);
      }
      if (key && key.ctrl && key.name === 'd') {
        process.stdout.write('\n');
        process.exit(0);
      }
      // ignore everything else
    };
    process.stdin.on('keypress', keypressListener);

  } else {
    if (keypressListener) {
      process.stdin.off('keypress', keypressListener);
      keypressListener = null;
    }

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(false); } catch {}
    }

    rl.resume();
    prompt();
  }
}

function prompt() {
  if (inputLocked) return;
  rl.setPrompt('> ');
  rl.prompt(true);
}

function logLine(line) {
  // When unlocked, avoid breaking the prompt line.
  if (!inputLocked) {
    try {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    } catch {}
  }
  process.stdout.write(line + '\n');
  prompt();
}

function writeStream(chunk, channel) {
  // While streaming, we DO NOT clear lines or re-prompt (prevents "refresh wipe")
  process.stdout.write(chunk);
  if (channel && chunk && chunk.length > 0) {
    lastStreamChar[channel] = chunk.slice(-1);
  }
}

// WebSocket
const ws = new WebSocket(url);

ws.on('open', () => {
  logLine(`[WS] connected: ${url}`);
  logLine(`[WS] username: ${username}`);
  logLine('Type a message then press Enter. (/quit to exit)');
  prompt();
});

ws.on('message', (data) => {
  const text = data.toString('utf8');
  if (rawMode) {
    logLine(`[RAW] ${text}`);
  }

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    logLine(`[WS] (non-JSON) ${text}`);
    return;
  }

  switch (msg.type) {
    case 'ack':
      activeRequestId = msg.requestId || activeRequestId;
      streamingChannel = null;
      printedPrefixForChannel = false;
      lastStatusKey = null;
      lastRoundEndKey = null;
      lastStreamChar.think = '';
      lastStreamChar.talk = '';
      lockInput(true);
      logLine(`[ACK] requestId=${msg.requestId}`);
      break;

    case 'status': {
      const toolName = msg.tool?.name || '';
      const toolSource = msg.tool?.source || '';
      const key = `${msg.phaseId}|${msg.state}|${msg.usingTool ? 1 : 0}|${toolName}|${toolSource}`;
      if (key !== lastStatusKey) {
        lastStatusKey = key;
        const tool = toolName ? ` tool=${toolName}(${toolSource || 'unknown'})` : '';
        logLine(`[STATUS] phaseId=${msg.phaseId} state=${msg.state} usingTool=${msg.usingTool}${tool}`);
      }
      break;
    }

    case 'delta': {
      const ch = msg.channel === 'think' ? 'think' : 'talk';
      const prefix = ch === 'think' ? '[THINK] ' : '[TALK]  ';

      // Sanitize streaming to avoid noisy terminal output.
      let content = String(msg.content ?? '');
      if (ch === 'think' && content === '') {
        return;
      }

      if (streamingChannel !== ch || !printedPrefixForChannel) {
        streamingChannel = ch;
        printedPrefixForChannel = true;
        lastStreamChar[ch] = '';
        writeStream(`\n${prefix}`);
      }

      const prevChar = lastStreamChar[ch] || '';
      const lastIsWord = /[A-Za-z0-9]$/.test(prevChar);
      const nextIsWord = /^[A-Za-z0-9]/.test(content);
      const needsSpace = lastIsWord && nextIsWord;
      if (needsSpace) {
        writeStream(' ', ch);
      }

      writeStream(content, ch);
      break;
    }

    case 'round_end': {
      const key = `${msg.phaseId}|${msg.round}`;
      if (key !== lastRoundEndKey) {
        lastRoundEndKey = key;
        logLine(`[ROUND_END] phaseId=${msg.phaseId} round=${msg.round} toolTriggered=${msg.toolTriggered}`);
        logLine('(工具回合結束，正在生成最終回覆...)');
      }
      break;
    }

    case 'end':
      writeStream(`\n\n[END] phaseId=${msg.phaseId} round=${msg.round} toolTriggered=${msg.toolTriggered} final=${msg.final}\n`);
      activeRequestId = null;
      lockInput(false);
      break;

    case 'error':
      writeStream(`\n[ERROR] ${msg.message}\n`);
      activeRequestId = null;
      lockInput(false);
      break;

    default:
      logLine(`[WS] ${JSON.stringify(msg)}`);
      break;
  }
});

ws.on('close', (code, reason) => {
  writeStream(`\n[WS] closed code=${code} reason=${reason?.toString?.() || reason}\n`);
  process.exit(0);
});

ws.on('error', (err) => {
  writeStream(`\n[WS] error: ${err.message}\n`);
});

rl.on('line', (line) => {
  const trimmed = line.trim();

  if (trimmed === '') {
    prompt();
    return;
  }

  if (trimmed === '/quit') {
    rl.close();
    ws.close();
    return;
  }

  if (trimmed.startsWith('/raw ')) {
    const v = trimmed.slice('/raw '.length).trim().toLowerCase();
    rawMode = v === 'on';
    logLine(`[CFG] rawMode=${rawMode}`);
    return;
  }

  if (inputLocked) {
    logLine('[INPUT] locked: wait for END/ERROR');
    return;
  }

  const requestId = newRequestId();
  const payload = {
    type: 'request',
    requestId,
    username,
    message: trimmed,
  };

  // lock immediately so user cannot type during streaming
  activeRequestId = requestId;
  lockInput(true);

  ws.send(JSON.stringify(payload));
});

rl.on('SIGINT', () => {
  // Ctrl+C when not locked
  writeStream('\n^C\n');
  process.exit(0);
});
