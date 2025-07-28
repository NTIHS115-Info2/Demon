
jest.mock('discord.js', () => {
  const { EventEmitter } = require('events');
  class MockClient extends EventEmitter {
    constructor() {
      super();
      this.login = jest.fn().mockResolvedValue();
      this.destroy = jest.fn().mockResolvedValue();
      this.channels = { fetch: jest.fn().mockResolvedValue({ send: jest.fn() }) };
      this.user = { id: 'bot' };
    }
  }
  return {
    Client: jest.fn(() => new MockClient()),
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3 },
    Partials: { Channel: 0 },
    REST: jest.fn(() => ({ setToken: function(){return this;}, put: jest.fn().mockResolvedValue() })),
    Routes: { applicationGuildCommands: jest.fn() },
    SlashCommandBuilder: jest.fn(() => ({ setName: () => ({ setDescription: () => ({ toJSON: () => ({}) }) }) }))
  };
}, { virtual: true });

// 模擬 Discord 設定檔供各策略載入
jest.mock('../src/plugins/discord/config', () => ({
  token: 't',
  applicationId: 'a',
  guildId: 'g',
  channelId: 'c',
  userId: 'cookice'
}), { virtual: true });

const discordLocal = require('../src/plugins/discord/strategies/local');
const discordPlugin = require('../src/plugins/discord');

describe('Discord 本地策略', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await discordLocal.offline();
  });

  test('online 會建立 Client 並登入', async () => {
    await discordLocal.online({ token: 't', applicationId:'a', guildId:'g' });
    const { Client } = require('discord.js');
    expect(Client).toHaveBeenCalled();
    const inst = Client.mock.results[0].value;
    expect(inst.login).toHaveBeenCalledWith('t');
  });

  test('send 會發送訊息至指定頻道', async () => {
    await discordLocal.online({ token: 't', applicationId:'a', guildId:'g' });
    const inst = require('discord.js').Client.mock.results[0].value;
    await discordLocal.send({ channelId: '123', message: 'hi' });
    const channel = await inst.channels.fetch.mock.results[0].value;
    expect(channel.send).toHaveBeenCalledWith('hi');
  });

  test('offline 會登出 Client', async () => {
    await discordLocal.online({ token: 't', applicationId:'a', guildId:'g' });
    const inst = require('discord.js').Client.mock.results[0].value;
    await discordLocal.offline();
    expect(inst.destroy).toHaveBeenCalled();
  });
});

describe('Discord 插件 send 分派', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await discordPlugin.offline();
  });

  test('func="send" 會轉交至策略 send', async () => {
    await discordPlugin.online({ token: 't', applicationId:'a', guildId:'g' });
    const spy = jest.spyOn(discordLocal, 'send');
    await discordPlugin.send({ func: 'send', channelId: '1', message: 'hi' });
    expect(spy).toHaveBeenCalledWith({ channelId: '1', message: 'hi' });
  });

  test('func="restart" 會呼叫插件 restart', async () => {
    const spy = jest.spyOn(discordLocal, 'restart').mockResolvedValue();
    await discordPlugin.send({ func: 'restart', token: 'x' });
    expect(spy).toHaveBeenCalledWith({ token: 'x' });
  });
});
