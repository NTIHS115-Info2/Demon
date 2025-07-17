module.exports = {
  // 子網域名稱，提供給 ngrok 註冊與遠端存取
  subdomain: 'llama',
  // 透過遠端存取時，可使用的 API 路由
  routes: {
    send: 'send',
  }
};
