// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
// Vitest 4 的 vi.fn() 箭頭實作無法以 new 呼叫，AntD 內部會 new ResizeObserver()，改用類別
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
// ★ 2026-09-30：舊版測試 mock 已移除的 usePrivacyStore，並點擊元件內已不存在的「下一步」按鈕
//   （換頁改由 MainLayout 統一處理）。改為對真正的 useWorkspaceStore 寫入狀態，並驗證元件內
//   「N 個欄位設定未完成」的防呆提示是否正確出現。
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { App } from 'antd';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key),
  }),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockApp.useApp = () => ({
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() },
    modal: { confirm: vi.fn() },
    notification: { error: vi.fn(), warning: vi.fn() },
  });
  return { ...actual, App: MockApp };
});

describe('DifferentialPrivacyMapping Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 未啟用 vitest globals 時 Testing Library 不會自動清除上一個測試的畫面，需手動 cleanup
  afterEach(() => {
    cleanup();
  });

  const setupStore = (dpFields: Partial<DPField>[]) => {
    useWorkspaceStore.setState({
      columns: ['salary'],
      previewData: [],
      dataFile: null,
      dpFields: dpFields as DPField[],
      datasetColumnNumericValuesMap: {},
      preprocessingRules: {},
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  };

  it('表單驗證：數值型欄位未填寫上下界時，應顯示「欄位設定未完成」提示', () => {
    setupStore([{ id: '1', fieldName: 'salary', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1.0, delta: 0 }]);
    render(<App><DifferentialPrivacyMapping /></App>);
    expect(screen.getByText(/個欄位設定未完成/)).toBeInTheDocument();
  });

  it('驗證成功：上下界合法時，不應顯示「欄位設定未完成」提示', () => {
    setupStore([{ id: '1', fieldName: 'salary', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1.5, delta: 0, lowerBound: 20000, upperBound: 100000 }]);
    render(<App><DifferentialPrivacyMapping /></App>);
    expect(screen.queryByText(/個欄位設定未完成/)).not.toBeInTheDocument();
  });
});
