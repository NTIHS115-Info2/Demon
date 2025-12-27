const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const Logger = require('../../utils/logger');

const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

class GmailClient {
  constructor(options = {}) {
    this.logger = new Logger('EmailConcierge');
    this.credentialsPath =
      options.credentialsPath ||
      path.resolve(__dirname, '../../../Server/calendar/config/credentials.json');
    this.tokenPath =
      options.tokenPath || path.resolve(__dirname, '../../../Server/calendar/config/token.json');
    this.scopes = options.scopes || DEFAULT_SCOPES;
    this.oauth2Client = null;
    this.gmail = null;
  }

  async init() {
    const credentials = await this.loadCredentials();
    const { client_id, client_secret, redirect_uris } = this.extractClientInfo(credentials);

    this.oauth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    const token = await this.loadToken();
    this.oauth2Client.setCredentials(token);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    return this;
  }

  async checkUnreadMessages(limit = 10) {
    if (!this.gmail) {
      throw new Error('Gmail client 尚未初始化');
    }

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: limit
    });

    return (response.data.messages || []).map((message) => ({
      id: message.id,
      threadId: message.threadId
    }));
  }

  async getMessageDetails(messageId) {
    if (!this.gmail) {
      throw new Error('Gmail client 尚未初始化');
    }

    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const payload = response.data.payload || {};
    const headers = payload.headers || [];
    const body = this.extractBody(payload);

    this.logger.info(`Message ID: ${messageId} | Status: fetched`);

    return {
      id: response.data.id,
      threadId: response.data.threadId,
      labelIds: response.data.labelIds,
      headers,
      body
    };
  }

  async loadCredentials() {
    const raw = await fs.promises.readFile(this.credentialsPath, 'utf8');
    return JSON.parse(raw);
  }

  async loadToken() {
    try {
      const raw = await fs.promises.readFile(this.tokenPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (process.env.GMAIL_OAUTH_TOKEN) {
      return JSON.parse(process.env.GMAIL_OAUTH_TOKEN);
    }

    if (process.env.GMAIL_OAUTH_TOKEN_BASE64) {
      const decoded = Buffer.from(process.env.GMAIL_OAUTH_TOKEN_BASE64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    }

    throw new Error('找不到 Gmail token，請提供 token.json 或設定環境變數。');
  }

  extractClientInfo(credentials) {
    const source = credentials.installed || credentials.web;
    if (!source) {
      throw new Error('找不到 OAuth2 用戶端資訊');
    }

    return {
      client_id: source.client_id,
      client_secret: source.client_secret,
      redirect_uris: source.redirect_uris || []
    };
  }

  extractBody(payload) {
    if (!payload) {
      return '';
    }

    if (payload.body && payload.body.data) {
      return this.decodeMessage(payload.body.data);
    }

    const parts = payload.parts || [];
    const plainPart = this.findPart(parts, 'text/plain');
    if (plainPart && plainPart.body && plainPart.body.data) {
      return this.decodeMessage(plainPart.body.data);
    }

    const htmlPart = this.findPart(parts, 'text/html');
    if (htmlPart && htmlPart.body && htmlPart.body.data) {
      return this.decodeMessage(htmlPart.body.data);
    }

    return '';
  }

  findPart(parts, mimeType) {
    for (const part of parts) {
      if (part.mimeType === mimeType) {
        return part;
      }

      if (part.parts && part.parts.length) {
        const found = this.findPart(part.parts, mimeType);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  decodeMessage(data) {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  }
}

module.exports = GmailClient;
