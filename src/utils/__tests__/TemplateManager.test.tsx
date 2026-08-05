import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import '@testing-library/jest-dom'; 

// ------------------------------------------------------------------
// 🌟 解決 Ant Design 報錯 1：模擬 JSDOM 缺少的 window.matchMedia 環境
// ------------------------------------------------------------------
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), 
    removeListener: vi.fn(), 
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ------------------------------------------------------------------
// 🌟 解決 Ant Design 報錯 2：模擬 JSDOM 缺少的 ResizeObserver 環境 (改用 class)
// ------------------------------------------------------------------
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// 🌟 請確認 TemplateManager 實際的路徑
import TemplateManager from '../../features/step2_mapping/TemplateManager'; 
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { App } from 'antd';

// ------------------------------------------------------------------
// 1. Mock 依賴套件與 Store
// ------------------------------------------------------------------
// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

// Mock usePrivacyStore
vi.mock('../../store/usePrivacyStore', () => ({
  usePrivacyStore: vi.fn(),
}));

const mockSaveTemplate = vi.fn();
const mockApplyTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockMessageSuccess = vi.fn();
const mockModalConfirm = vi.fn();

// Mock Ant Design 的 App.useApp()
vi.mock('antd', async () => {
  const actual = await vi.importActual<any>('antd');
  
  const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  
  MockApp.useApp = () => ({
    message: { success: mockMessageSuccess },
    modal: { confirm: mockModalConfirm },
  });

  return {
    ...actual,
    App: MockApp,
  };
});

// ------------------------------------------------------------------
// 2. 測試本體
// ------------------------------------------------------------------
describe('TemplateManager Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    const mockState = {
      privacyMode: 'differential-privacy',
      templates: [
        { id: '1', name: '既有範本', privacyMode: 'differential-privacy', description: '' },
        { id: '2', name: 'K匿名範本', privacyMode: 'k-anonymity', description: '' }
      ],
      saveTemplate: mockSaveTemplate,
      applyTemplate: mockApplyTemplate,
      deleteTemplate: mockDeleteTemplate,
    };

    (usePrivacyStore as unknown as Mock).mockImplementation((selector: (state: typeof mockState) => unknown) => {
      return selector(mockState);
    });
  });

  const renderComponent = () => render(
    <App>
      <TemplateManager />
    </App>
  );

  it('點擊「將當前設定存為新範本」應能打開新增表單', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: /範本管理/i }));
    await user.click(screen.getByRole('button', { name: /將當前設定存為新範本/i }));
    
    expect(screen.getByLabelText(/範本名稱/i)).toBeInTheDocument();
  });

  it('表單驗證：輸入已存在的範本名稱應被阻擋', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: /範本管理/i }));
    await user.click(screen.getByRole('button', { name: /將當前設定存為新範本/i }));

    const nameInput = screen.getByLabelText(/範本名稱/i);
    await user.type(nameInput, '既有範本');
    
    await user.click(screen.getByRole('button', { name: /確認儲存/i }));

    await waitFor(() => {
      expect(screen.getByText('此範本名稱已存在，請更換名稱')).toBeInTheDocument();
    });
    
    expect(mockSaveTemplate).not.toHaveBeenCalled();
  });

  it('防禦性阻斷：套用不同隱私模式的範本時，應觸發確認彈窗', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: /範本管理/i }));

    const applyButtons = screen.getAllByRole('button', { name: /套用/i });
    await user.click(applyButtons[1]); 

    expect(mockModalConfirm).toHaveBeenCalledTimes(1);
    expect(mockModalConfirm.mock.calls[0][0]).toMatchObject({
      title: '⚠️ 隱私模式不符提示',
    });
  });

  it('同模式套用：套用相同隱私模式的範本時，應直接套用不彈窗', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: /範本管理/i }));

    const applyButtons = screen.getAllByRole('button', { name: /套用/i });
    await user.click(applyButtons[0]);

    expect(mockModalConfirm).not.toHaveBeenCalled();
    expect(mockApplyTemplate).toHaveBeenCalledWith('1');
    expect(mockMessageSuccess).toHaveBeenCalledWith(expect.stringContaining('已一鍵套用範本'));
  });
});