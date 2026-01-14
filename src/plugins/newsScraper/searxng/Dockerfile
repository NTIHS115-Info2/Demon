# src/plugins/newsScraper/searxng/Dockerfile

# 使用官方最新版作為基底
FROM searxng/searxng:latest

# 【關鍵動作】直接將我們的設定檔「燒錄」進去
# 這會覆蓋掉原廠預設值，並解決所有權限與掛載問題
COPY settings.yml /etc/searxng/settings.yml

# 修正權限，確保 searxng 使用者絕對能讀取
USER root
RUN chmod 644 /etc/searxng/settings.yml && \
    chown searxng:searxng /etc/searxng/settings.yml

# 切回 searxng 使用者啟動服務
USER searxng