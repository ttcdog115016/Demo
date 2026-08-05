import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import '@testing-library/jest-dom';

// 🌟 全局 Mock Ant Design 依賴
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
});
global.ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));

import Step2_Mapping from '../../features/step2_mapping/Step2_Mapping';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { App } from 'antd';

vi.mock('../../features/step2_mapping/KAnonymityMapping', () => ({ default: () => <div data-testid="k-anon-mapping" /> }));
vi.mock('../../features/step2_mapping/DifferentialPrivacyMapping', () => ({ default: () => <div data-testid="dp-mapping" /> }));
vi.mock('../../features/step2_mapping/TemplateManager', () => ({ default: () => <div data-testid="template-manager" /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('../../store/usePrivacyStore', () => ({
  usePrivacyStore: vi.fn(),
}));

// 🌟 修正點：將 MockApp 移入 vi.mock 內部，避免 hoisting 問題
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd') as Record<string, unknown>;
  const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockApp.useApp = () => ({ message: { success: vi.fn(), error: vi.fn() }, modal: { confirm: vi.fn() } });
  return { ...actual, App: MockApp };
});

describe('Step2_Mapping Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupStore = (preprocessingRules = {}, privacyMode = 'differential-privacy') => {
    const mockState = {
      privacyMode,
      columns: ['phone_number'],
      previewData: [{ phone_number: '0912 345 678' }],
      preprocessingRules,
    };
   // 🌟 修正點：判斷 selector 是否存在
    const mockUsePrivacyStore = usePrivacyStore as unknown as Mock & { setState?: ReturnType<typeof vi.fn> };
    mockUsePrivacyStore.mockImplementation((selector?: (state: typeof mockState) => unknown) => {
      if (typeof selector === 'function') {
        return selector(mockState);
      }
      return mockState; // 沒傳 selector 時，回傳整包 state
    });
    
    mockUsePrivacyStore.setState = vi.fn();
  };

  it('應正確渲染第一階段清洗表格與預覽', () => {
    setupStore();
    render(<App><Step2_Mapping /></App>);
    
    // 檢查欄位與原始預覽資料是否存在
    expect(screen.getByText('phone_number')).toBeInTheDocument();
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
  });

  it('當隱私模式不同時，應切換渲染對應的第二階段元件', () => {
    // 測試 DP 模式
    setupStore({}, 'differential-privacy');
    const { unmount } = render(<App><Step2_Mapping /></App>);
    expect(screen.getByTestId('dp-mapping')).toBeInTheDocument();
    unmount();

    // 測試 K-Anon 模式
    setupStore({}, 'k-anonymity');
    render(<App><Step2_Mapping /></App>);
    expect(screen.getByTestId('k-anon-mapping')).toBeInTheDocument();
  });
});