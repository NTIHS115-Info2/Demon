const http = require('http');
const express = require('express');

async function startExpressApp() {
  const app = express();
  const server = http.createServer(app);
  const sockets = new Set();

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  return {
    app,
    server,
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(resolve);
      })
  };
}

module.exports = {
  startExpressApp
};
