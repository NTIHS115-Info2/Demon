// 模擬 TalkToDemon
jest.mock('../src/core/TalkToDemon', () => {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  emitter.talk = jest.fn(() => {
    emitter.emit('data', '你好。');
    emitter.emit('data', '再見。');
    emitter.emit('end');
  });
  return emitter;
}, { virtual: true });
const talker = require('../src/core/TalkToDemon');

const handler = require('../src/plugins/discord/strategies/local/messageHandler');

describe('Discord MessageHandler', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('handleDirectMessage 僅回應指定使用者', async () => {
    const msg = { content:'hi', author:{ id:'cookice' }, reply: jest.fn().mockResolvedValue(), channel:{ type:'DM' } };
    await handler.handleDirectMessage(msg, 'cookice');
    expect(talker.talk).toHaveBeenCalledWith('爸爸', 'hi');
    expect(msg.reply).toHaveBeenCalledWith('你好。');
    expect(msg.reply).toHaveBeenCalledWith('再見。');
  });

  test('handleDirectMessage 拒絕陌生人', async () => {
    const msg = { content:'hi', author:{ id:'other' }, reply: jest.fn().mockResolvedValue(), channel:{ type:'DM' } };
    await handler.handleDirectMessage(msg, 'cookice');
    expect(talker.talk).not.toHaveBeenCalled();
    expect(msg.reply).toHaveBeenCalledWith('我還學不會跟別人說話');
  });

  test('handleMentionMessage 會移除提及內容', async () => {
    const msg = { content:'<@bot> hello', author:{ id:'cookice' }, reply: jest.fn().mockResolvedValue(), channel:{ type:'GUILD_TEXT' } };
    await handler.handleMentionMessage(msg, 'bot', 'cookice');
    expect(talker.talk).toHaveBeenCalledWith('爸爸', 'hello');
  });
});
