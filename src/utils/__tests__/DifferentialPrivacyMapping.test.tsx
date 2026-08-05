import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import '@testing-library/jest-dom';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
});
global.ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));

import DifferentialPrivacyMapping from '../../features/step2_mapping/DifferentialPrivacyMapping';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { App } from 'antd';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('../../store/usePrivacyStore', () => ({
  usePrivacyStore: vi.fn(),
}));

// 🌟 修正點：加入 mockNextStep
const { mockMessageSuccess, mockMessageError, mockNextStep } = vi.hoisted(() => ({
  mockMessageSuccess: vi.fn(),
  mockMessageError: vi.fn(),
  mockNextStep: vi.fn(),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockApp.useApp = () => ({
    message: { success: mockMessageSuccess, error: mockMessageError },
    modal: { confirm: vi.fn() }
  });
  return { ...actual, App: MockApp };
});

describe('DifferentialPrivacyMapping Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupStore = (dpFields: unknown[]) => {
    const mockState = {
      columns: ['salary'],
      previewData: [],
      dpFields,
      toggleFieldEnable: vi.fn(),
      setColumnType: vi.fn(),
      setFileData: vi.fn(),
      updateFieldDP: vi.fn(),
      nextStep: mockNextStep, // 🌟 注入 nextStep 供測試斷言
    };
    
    (usePrivacyStore as unknown as Mock).mockImplementation((selector?: unknown) => {
      if (typeof selector === 'function') {
        return selector(mockState);
      }
      return mockState;
    });
    
    (usePrivacyStore as unknown as { getState: () => unknown }).getState = () => ({ preprocessingRules: {} });
  };

  it('表單驗證：若數值型欄位未填寫上下界，應顯示警告並阻擋進入下一步', async () => {
    const user = userEvent.setup();
    setupStore([{
      id: '1', fieldName: 'salary', fieldType: 'Numeric', enabled: true, mode: 'epsilon', epsilon: 1.0, delta: 0
    }]);

    render(<App><DifferentialPrivacyMapping /></App>);

    // 🌟 尋找「下一步」按鈕
    const nextBtn = screen.getByRole('button', { name: /下一步/i });
    await user.click(nextBtn);

    // 驗證是否被阻擋並跳出錯誤訊息
    expect(mockMessageError).toHaveBeenCalledWith(expect.stringContaining('設定尚未完成'));
    // 確保沒有進入第三步
    expect(mockNextStep).not.toHaveBeenCalled();
  });

  it('驗證成功：當設定合法時，應允許進入下一步', async () => {
    const user = userEvent.setup();
    setupStore([{
      id: '1', fieldName: 'salary', fieldType: 'Numeric', enabled: true, mode: 'epsilon', 
      epsilon: 1.5, delta: 0, lowerBound: 20000, upperBound: 100000
    }]);

    render(<App><DifferentialPrivacyMapping /></App>);

    // 🌟 尋找「下一步」按鈕
    const nextBtn = screen.getByRole('button', { name: /下一步/i });
    await user.click(nextBtn);

    // 驗證是否成功呼叫 nextStep 進入第三步
    expect(mockNextStep).toHaveBeenCalled();
  });
});