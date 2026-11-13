# Open-PETs 前端軟體物料清單（SBOM）摘要

- 產生時間：2026-11-13T00:00:07Z
- 格式：CycloneDX 1.5（JSON），完整清單見 `frontend-sbom.cdx.json`
- 主元件：open-pets-frontend 2.0.0（MIT）
- 範圍：正式執行相依（package.json 的 dependencies 及其傳遞相依）；建置與測試工具（devDependencies）不隨產品交付，不列入
- 元件總數：191（直接相依 21、間接相依 170）
- 後端（Python）SBOM 另見交付套件「3.2_附件二_軟體物料清單SBOM.json」
- 每個元件的授權全文已直接放在 SBOM 內（`licenses[].license.text`）；另提供 `FRONTEND_THIRD_PARTY_LICENSES.md`（授權清單）、`3.2_附件一_開源元件授權全文_前端.txt`（授權全文純文字版，版面比照廠商附件一），授權清單格式比照後端的 THIRD_PARTY_LICENSES.md
- 重新產生：`npm install` 後執行 `npm run sbom`

## 直接相依

| 套件 | 版本 | 授權 |
|---|---|---|
| @ant-design/icons | 6.3.4 | MIT |
| @tanstack/react-query | 5.107.1 | MIT |
| antd | 6.7.0 | MIT |
| axios | 1.21.1 | MIT |
| crypto-js | 4.2.0 | MIT |
| echarts | 6.1.0 | Apache-2.0 |
| echarts-for-react | 3.0.6 | MIT |
| html2pdf.js | 0.14.0 | MIT |
| i18next | 26.7.2 | MIT |
| lucide-react | 1.70.0 | ISC |
| papaparse | 5.7.0 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| react-dropzone | 15.0.0 | MIT |
| react-i18next | 17.1.13 | MIT |
| react-router-dom | 7.18.5 | MIT |
| recharts | 3.10.1 | MIT |
| swagger-ui-dist | 5.34.1 | Apache-2.0 |
| xlsx | 0.20.3 | Apache-2.0 |
| yaml | 2.9.1 | ISC |
| zustand | 5.1.0 | MIT |

## 授權統計（全部元件）

| 授權 | 元件數 |
|---|---|
| MIT | 164 |
| ISC | 14 |
| Apache-2.0 | 4 |
| 0BSD | 3 |
| BSD-3-Clause | 2 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| MIT OR SEE LICENSE IN FEEL-FREE.md | 1 |
| MIT AND ISC | 1 |
