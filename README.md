# Open-PETs（隱私強化工具包）

前端（React＋TypeScript＋Vite）與後端（FastAPI，`backend/`）。以單一 Docker 映像檔交付，同一份映像檔以環境變數 `OPEN_PETS_MODE` 切換三種模式：本地（`local`）、內網（`lan`，內建 HTTPS）、線上（`online`，對外網域）。

| 交付方式 | 說明 |
|---|---|
| 容器映像檔 | `ghcr.io/<擁有者>/open-pets-app:<版本>`，有網路時用 `docker compose pull` 更新 |
| 離線安裝 | 交付包的 `open-pets-app_<版本>.tar.gz`，`docker load -i` 後以 compose 啟動 |
| 原始碼 | 本 repo 或交付包的 `open-pets-source_<版本>.zip`，依 [`docker/REBUILD.md`](docker/REBUILD.md) 重新建置 |

**第一次安裝請用附的小工具 `open-pets.ps1`（Windows）／`open-pets.sh`（Linux）**：`setup` 用問答帶你安裝，`mode local|lan|online` 隨時切換模式。安裝、升級、備份、模式切換與驗證方式見 [`docker/README_Docker.md`](docker/README_Docker.md)。授權：本專案 MIT（`LICENSE`、`backend/LICENSE`）；第三方元件的授權與取得原始碼方式見映像檔內 `/licenses`。

---

（以下為前端專案建立時的 Vite 範本說明）

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```


### 🎭 展示模式設定 (Demo Mode Configuration)

為了在向客戶或非技術人員進行產品展示 (Demo) 時保持流程專注，避免誤觸管理員功能，您可以透過以下設定將「Admin (系統管理員)」視角暫時隱藏，使整個系統純粹呈現「Data Owner (資料擁有者)」的工作流。

#### 1. 隱藏右上角全域角色切換 (Global Header)
在全域版面配置檔（如 `src/App.tsx`、`src/MainLayout.tsx` 或 Header 元件）中，找到 `userMenuItems` 下拉選單設定，將 Admin 選項註解：
```tsx
const userMenuItems = [
  {
    key: 'rbac-title',
    label: 'Switch Role (RBAC Demo)',
    disabled: true,
  },
  // 🌟 Demo 時先隱藏 Admin 切換按鈕
  // {
  //   key: 'switch-admin',
  //   label: 'Admin',
  //   onClick: () => setUserRole('admin'), 
  // },
  {
    key: 'switch-data-owner',
    label: 'Data Owner',
    onClick: () => setUserRole('data_owner'),
  },
  // ...其他選項
];
```

#### 2. 隱藏後台使用者列表中的 Admin (SystemPreferences.tsx)
在 `src/features/settings/SystemPreferences.tsx` 中，利用 `filter` 陣列方法過濾掉 Admin 帳號，保持資料結構不變但畫面上不可見：
```tsx
<Table 
  columns={userColumns} 
  // 🌟 只顯示 data_owner
  dataSource={users.filter(u => u.role === 'data_owner')} 
  rowKey="id" 
  pagination={{ pageSize: 5 }} 
  size="middle" 
/>
```

#### 3. 隱藏新增使用者的 Admin 選項
同樣在 `SystemPreferences.tsx` 中，找到「新增使用者」的 `Modal` 表單，將 `Select` 的 Admin 選項註解：
```tsx
<Select 
  options={[
    // 🌟 隱藏建立 Admin 的選項
    // { value: 'admin', label: t('admin.role_admin', 'Admin (系統管理員)') },
    { value: 'data_owner', label: t('admin.role_data_owner', 'Data Owner (資料擁有者)') }
  ]} 
/>
```

> **💡 開發提示**：這是一種「非破壞性」的隱藏方式。未來若需要恢復完整的 RBAC (Role-Based Access Control) 開發測試功能，只需將上述程式碼的註解解除，並拿掉 `filter` 即可瞬間恢復雙角色切換。
