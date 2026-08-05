import { useEffect } from 'react';
import { mountVercelToolbar } from '@vercel/toolbar';

export function VercelToolbar() {
  useEffect(() => {
    console.log("=== 正在嘗試掛載 Vercel Toolbar ===");
    
    // 暫時先不管是不是 DEV 環境，強制執行看看
    const cleanup = mountVercelToolbar();
    
    console.log("=== 掛載完成，回傳值：===", cleanup);
    
    return cleanup;
  }, []);

  return null;
}