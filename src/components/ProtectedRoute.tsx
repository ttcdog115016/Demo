import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { usePrivacyStore } from '../store/usePrivacyStore'; // 注意路徑是否正確

interface ProtectedRouteProps {
  allowedRoles: string[];
  redirectPath: string;
}

export default function ProtectedRoute({ allowedRoles, redirectPath }: ProtectedRouteProps) {
  const user = usePrivacyStore((state) => state.user);
  const { message } = AntdApp.useApp();
  const { t } = useTranslation();
  const location = useLocation();
  
  // 若無設定 user，預設當作 data_owner 處理
  const currentRole = user?.role || 'data_owner';
  const isAllowed = allowedRoles.includes(currentRole);

  useEffect(() => {
    if (!isAllowed) {
      // 若越權存取，跳出警告提示
      message.error(t('msg.no_report_perm', '權限不足：您目前的角色無法存取該頁面，已將您導回專屬工作區。'));
    }
  }, [isAllowed, message, t, location.pathname]);

  if (!isAllowed) {
    // 踢回指定的合法路徑
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />; // 權限相符，放行渲染子路由
}