# Open-PETs 前端軟體物料清單（SBOM）摘要

- 產生時間：2026-11-02T05:44:30Z
- 格式：CycloneDX 1.5（JSON），完整清單見 `frontend-sbom.cdx.json`
- 主元件：open-pets-frontend 2.0.0（MIT）
- 範圍：正式執行相依（package.json 的 dependencies 及其傳遞相依）；建置與測試工具（devDependencies）不隨產品交付，不列入
- 元件總數：183（直接相依 20、間接相依 163）
- 後端（Python）SBOM 另見交付套件「3.2_附件二_軟體物料清單SBOM.json」
- 重新產生：`npm install` 後執行 `npm run sbom`

## 直接相依

| 套件 | 版本 | 授權 |
|---|---|---|
| @ant-design/icons | 6.3.2 | MIT |
| @tanstack/react-query | 5.101.2 | MIT |
| antd | 6.5.0 | MIT |
| axios | 1.20.0 | MIT |
| crypto-js | 4.2.0 | MIT |
| echarts | 6.1.0 | Apache-2.0 |
| echarts-for-react | 3.0.6 | MIT |
| html2pdf.js | 0.10.1 | MIT |
| i18next | 26.3.6 | MIT |
| lucide-react | 1.25.0 | ISC |
| papaparse | 5.5.4 | MIT |
| react | 19.2.7 | MIT |
| react-dom | 19.2.7 | MIT |
| react-dropzone | 15.0.0 | MIT |
| react-i18next | 17.0.11 | MIT |
| react-router-dom | 7.18.2 | MIT |
| recharts | 3.9.2 | MIT |
| xlsx | 0.20.3 | Apache-2.0 |
| yaml | 2.8.4 | ISC |
| zustand | 5.0.14 | MIT |

## 授權統計（全部元件）

| 授權 | 元件數 |
|---|---|
| MIT | 157 |
| ISC | 14 |
| 0BSD | 3 |
| (MIT OR Apache-2.0) | 2 |
| BSD-3-Clause | 2 |
| Apache-2.0 | 2 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| MIT OR SEE LICENSE IN FEEL-FREE.md | 1 |
| MIT AND ISC | 1 |
