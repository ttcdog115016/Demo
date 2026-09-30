// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// 🌟 全局 Mock Ant Design 依賴
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
// Vitest 4 的 vi.fn() 箭頭實作無法以 new 呼叫，AntD 內部會 new ResizeObserver()，改用類別
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

import Step2_Mapping from '../../features/step2_mapping/Step2_Mapping';
// ★ 2026-09-30：舊版測試 mock 的是已移除的 usePrivacyStore，但元件實際讀的是 useWorkspaceStore，
//   mock 根本沒有作用。改為直接對真正的 useWorkspaceStore 寫入測試用狀態。
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { App } from 'antd';

vi.mock('../../features/step2_mapping/KAnonymityMapping', () => ({ default: () => <div data-testid="k-anon-mapping" /> }));
vi.mock('../../features/step2_mapping/DifferentialPrivacyMapping', () => ({ default: () => <div data-testid="dp-mapping" /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key),
  }),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd') as Record<string, unknown>;
  const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockApp.useApp = () => ({ message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
  return { ...actual, App: MockApp };
});

describe('Step2_Mapping Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 未啟用 vitest globals 時 Testing Library 不會自動清除上一個測試的畫面，需手動 cleanup
  afterEach(() => {
    cleanup();
  });

  const setupStore = (privacyMode: 'differential-privacy' | 'k-anonymity' = 'differential-privacy') => {
    useWorkspaceStore.setState({
      privacyMode,
      columns: ['phone_number'],
      previewData: [{ phone_number: '0912 345 678' }],
      preprocessingRules: {},
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  };

  it('應正確渲染第一階段清洗表格與預覽', () => {
    setupStore();
    render(<App><Step2_Mapping /></App>);

    expect(screen.getAllByText('phone_number').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0912 345 678').length).toBeGreaterThan(0);
  });

  it('當隱私模式不同時，應切換渲染對應的第二階段元件', () => {
    setupStore('differential-privacy');
    const { unmount } = render(<App><Step2_Mapping /></App>);
    expect(screen.getByTestId('dp-mapping')).toBeInTheDocument();
    unmount();

    setupStore('k-anonymity');
    render(<App><Step2_Mapping /></App>);
    expect(screen.getByTestId('k-anon-mapping')).toBeInTheDocument();
  });
});
