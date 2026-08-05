  import { useEffect, useCallback } from 'react';
  import { useNavigate, useSearchParams } from 'react-router-dom';
  import { App as AntdApp } from 'antd';
  import { useTranslation } from 'react-i18next';
  import { usePrivacyStore } from '../../store/usePrivacyStore';

  export const useIdleTimeout = (timeoutInMinutes: number) => {
    const logout = usePrivacyStore((state) => state.logout);
    const isAuthenticated = usePrivacyStore((state) => state.isAuthenticated);

    const { modal } = AntdApp.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // 🌟 外掛測試：網址如果有 ?test_timeout=5 則優先使用
    const devTestSeconds = searchParams.get('test_timeout');
    const actualTimeoutMs = devTestSeconds 
      ? Number(devTestSeconds) * 1000 
      : timeoutInMinutes * 60 * 1000;

    const handleTimeout = useCallback(() => {
      if (!isAuthenticated) return;

      sessionStorage.removeItem('loginTimestamp');
      logout();
      navigate('/login');
      
      modal.warning({
        title: t('timeout.title', '工作階段已逾時 (Session Expired)'),
        content: t('timeout.content', '基於嚴格的資安規範，您在此頁面的授權停留時間已達上限 ({{min}} 分鐘)，系統已將您強制登出以保護資料安全。', { min: timeoutInMinutes }),
        okText: t('modal.confirm', '重新登入'),
      });
    }, [isAuthenticated, logout, navigate, modal, t, timeoutInMinutes]);

    // 1. 初始化登入時間戳記
    useEffect(() => {
      if (isAuthenticated) {
        if (!sessionStorage.getItem('loginTimestamp')) {
          sessionStorage.setItem('loginTimestamp', Date.now().toString());
        }
      } else {
        sessionStorage.removeItem('loginTimestamp');
      }
    }, [isAuthenticated]);

    // 2. 輪詢稽查員：當 timeoutInMinutes 或 actualTimeoutMs 跨分頁被改動時，這段 Effect 會立刻重新響應！
    useEffect(() => {
      if (!isAuthenticated || actualTimeoutMs <= 0) return;

      const checkSession = () => {
        const startStr = sessionStorage.getItem('loginTimestamp');
        if (!startStr) return;

        const elapsed = Date.now() - Number(startStr);
        
        // 只要累積時間超過了最新的 timeout 設定，立刻觸發登出
        if (elapsed >= actualTimeoutMs) {
          handleTimeout();
        }
      };

      // 立即檢查一次
      checkSession();

      const intervalRef = setInterval(checkSession, 1000);

      return () => clearInterval(intervalRef);
    }, [actualTimeoutMs, isAuthenticated, handleTimeout]);
  };