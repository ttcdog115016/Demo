import { useEffect, useRef } from 'react';
import { App } from 'antd';

// 🌟 1. 改為引入拆分後的 Auth Store
import { useAuthStore } from '../../store/useAuthStore';

export const useIdleTimeout = (timeoutMinutes: number = 30) => {
  // 🌟 2. 從 AuthStore 取得登出方法與認證狀態
  const logout = useAuthStore((state) => state.logout);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { message } = App.useApp();
  
  const lastActivityRef = useRef<number>(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // 1. 使用者有任何操作時，更新最後活動時間
    const updateLastActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // 綁定事件監聽 (加入 { passive: true } 提升頁面滾動效能)
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((event) => window.addEventListener(event, updateLastActivity, { passive: true }));

    // 在副作用階段初始化最後活動時間
    updateLastActivity();

    // 2. 巡邏檢查：每 1 秒檢查一次是否超時
    intervalIdRef.current = setInterval(() => {
      const safeMinutes = timeoutMinutes || 30;
      const timeoutMs = safeMinutes * 60 * 1000;
      
      const idleTime = Date.now() - lastActivityRef.current;

      // 若閒置時間 >= 規定超時時間，觸發強制登出
      if (lastActivityRef.current !== 0 && idleTime >= timeoutMs) {
        console.log(`[閒置偵測] 已閒置超過 ${safeMinutes} 分鐘，觸發強制登出！`);
        logout();
        message.warning('由於您已閒置過久，系統已自動將您登出。');
        
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
        }
      }
    }, 1000);

    // 3. 清理資源
    return () => {
      events.forEach((event) => window.removeEventListener(event, updateLastActivity));
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, [timeoutMinutes, logout, isAuthenticated, message]);
};