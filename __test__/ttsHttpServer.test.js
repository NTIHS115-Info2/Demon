const express = require('express');
const axios = require('axios');

// Mock ngrok
jest.mock('../src/core/pluginsManager.js', () => ({
  send: jest.fn().mockResolvedValue(true),
  getPluginState: jest.fn().mockResolvedValue(1)
}), { virtual: true });

// Mock python-shell
jest.mock('python-shell', () => {
  const { EventEmitter } = require('events');
  return {
    PythonShell: jest.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      emitter.terminated = false;
      emitter.stdin = true;
      emitter.send = jest.fn();
      emitter.end = (cb) => { 
        emitter.terminated = true; 
        setTimeout(() => cb && cb(null, 0, null), 10);
      };
      return emitter;
    })
  };
}, { virtual: true });

const ttsPlugin = require('../src/plugins/tts');

describe('TTS Server Mode HTTP Endpoint Tests', () => {
  let app;
  let server;
  let port;

  beforeEach(async () => {
    jest.clearAllMocks();
    await ttsPlugin.offline();
    
    // Create Express app to simulate ngrok server
    app = express();
    app.use(express.json());
    
    // Simulate the TTS server endpoint
    app.post('/tts/send', async (req, res) => {
      try {
        const text = String(req.body.text || '');
        if (!text) {
          return res.status(400).json({ error: 'No text provided' });
        }
        
        // Simulate TTS processing
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Simulate potential error condition
        if (text === 'ERROR_TEST') {
          throw new Error('Simulated TTS error');
        }
        
        return res.status(200).json({ success: true, message: 'TTS processed successfully' });
      } catch (e) {
        return res.status(500).json({ error: 'TTS processing failed', details: e.message });
      }
    });

    // Start server on random port
    server = app.listen(0);
    port = server.address().port;
  });

  afterEach(async () => {
    if (server) {
      server.close();
    }
  });

  describe('HTTP /tts/send endpoint responses', () => {
    test('Returns 200 on successful TTS processing', async () => {
      const response = await axios.post(`http://localhost:${port}/tts/send`, {
        text: 'Hello, this is a test message.'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.message).toBe('TTS processed successfully');
    });

    test('Returns 500 on TTS processing error', async () => {
      try {
        await axios.post(`http://localhost:${port}/tts/send`, {
          text: 'ERROR_TEST'
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(500);
        expect(error.response.data.error).toBe('TTS processing failed');
        expect(error.response.data.details).toBe('Simulated TTS error');
      }
    });

    test('Returns 400 for empty text', async () => {
      try {
        await axios.post(`http://localhost:${port}/tts/send`, {
          text: ''
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('No text provided');
      }
    });

    test('Returns 400 for missing text field', async () => {
      try {
        await axios.post(`http://localhost:${port}/tts/send`, {});
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('No text provided');
      }
    });

    test('Handles multiple concurrent requests correctly', async () => {
      const requests = [
        axios.post(`http://localhost:${port}/tts/send`, { text: 'Message 1' }),
        axios.post(`http://localhost:${port}/tts/send`, { text: 'Message 2' }),
        axios.post(`http://localhost:${port}/tts/send`, { text: 'Message 3' })
      ];

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      });
    });

    test('Server handles mixed success and error responses', async () => {
      const requests = [
        axios.post(`http://localhost:${port}/tts/send`, { text: 'Success message' }).catch(e => e.response),
        axios.post(`http://localhost:${port}/tts/send`, { text: 'ERROR_TEST' }).catch(e => e.response),
        axios.post(`http://localhost:${port}/tts/send`, { text: 'Another success' }).catch(e => e.response)
      ];

      const responses = await Promise.all(requests);
      
      expect(responses[0].status).toBe(200);
      expect(responses[1].status).toBe(500);
      expect(responses[2].status).toBe(200);
    });
  });
});