// 執行期設定（預設為空：使用建置時的旗標，見 src/config/featureFlags.ts）。
// Docker 單一映像檔會由後端以環境變數 OPEN_PETS_MODE 等動態產生同名內容（docker/openpets_server.py），蓋過這個檔案。
window.__OPEN_PETS_CONFIG__ = {};
