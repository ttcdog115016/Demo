  /**
   * ============================================================================
   * 檔案名稱 (File): ProtectedRoute.tsx
   * 模組功能 (Description): 路由權限防護組件 (基於角色的存取控制 RBAC，提供越權警告與自動重導向)
   * 專案名稱 (Project): Privacy Protection Toolkit
   * 規範對照: 符合開發規範 a) 說明性檔案與原始檔案開頭註記, 變數函數與程序撰寫參考 a)~h)
   * ============================================================================
   */

  import { useEffect } from 'react';
  import { Navigate, Outlet, useLocation } from 'react-router-dom';
  import { App as AntdApp } from 'antd';
  import { useTranslation } from 'react-i18next';

  import { usePrivacyStore } from '../store/usePrivacyStore';

  /**
   * 預設常數字串宣告
   * 規範對照: 符合規範 e) 避免使用不易理解之常數字串 (Magic String)
   */
  const DEFAULT_USER_ROLE_NAME = 'data_owner';
  const I18N_KEY_NO_PERMISSION = 'msg.no_report_perm';
  const DEFAULT_NO_PERMISSION_MESSAGE = '權限不足：您目前的角色無法存取該頁面，已將您導回專屬工作區。';

  /**
   * 路由防護組件屬性介面
   * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
   */
  interface ProtectedRouteProps 
  {
    allowedRoles: string[]; // 允許存取該路由之角色名稱陣列
    redirectPath: string;   // 權限不足時自動重導向之目標路徑
  }

  /**
   * 函數名稱: ProtectedRoute
   * 函數功能: 檢查當前使用者角色是否包含於允許名單內，若不符則彈出錯誤訊息並導回安全路徑。
   * 
   * 輸入參數 (Input):
   *   - props (ProtectedRouteProps): 包含 allowedRoles (允許角色陣列) 與 redirectPath (導向路徑) 之屬性物件
   * 輸出參數 (Output): 無
   * 返回值 (Return): 
   *   - React.ReactElement: 權限相符時渲染子路由 (Outlet)，否則渲染重導向元件 (Navigate)
   * 呼叫關係 (Call Relations): 
   *   - 被 App.tsx 主路由配置載入作為 Layout 組件包裹受保護之路由
   *   - 訂閱 usePrivacyStore 取得當前使用者角色狀態
   * 
   * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素，以及變數防呆校驗 h)
   */
  export default function ProtectedRoute({ allowedRoles, redirectPath }: ProtectedRouteProps): React.ReactElement 
  {
    const currentUserSession = usePrivacyStore(
      (state) => state.user
    );

    const { message: messageApi } = AntdApp.useApp();

    const { t: translateFunction } = useTranslation();

    const currentRouteLocation = useLocation();
    
    // 若無設定使用者，預設當作 data_owner 處理 (符合變數撰寫規範 d, f 防呆與確實初始化)
    const activeUserRole = currentUserSession?.role || DEFAULT_USER_ROLE_NAME;

    // 校驗當前角色是否具備存取權限 (符合變數撰寫規範 h 精確實作)
    const hasAccessPermission = allowedRoles.includes(activeUserRole);

    useEffect(
      () => 
      {
        if (!hasAccessPermission) 
        {
          // 若越權存取，跳出警告提示 (符合變數撰寫規範 g 處理異常與錯誤回饋)
          messageApi.error(
            translateFunction(I18N_KEY_NO_PERMISSION, DEFAULT_NO_PERMISSION_MESSAGE)
          );
        }
      }, 
      [hasAccessPermission, messageApi, translateFunction, currentRouteLocation.pathname]
    );

    if (!hasAccessPermission) 
    {
      // 踢回指定的合法路徑
      return <Navigate to={redirectPath} replace />;
    }

    // 權限相符，放行渲染子路由
    return <Outlet />; 
  }