/**
 * ============================================================================
 * 檔案名稱 (File): App.tsx
 * 模組功能 (Description): 前端應用程式入口主組件 (提供 React Router 路由防護、RBAC 權限導向、Ant Design 全域主題與多國語系 Provider 配置)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Outlet } from 'react-router-dom';
import { 
    ConfigProvider, theme, Layout, Menu, Avatar, 
    App as AntdApp, Dropdown, Tag, Spin 
} from 'antd'; 
import { useTranslation } from 'react-i18next';

import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import type { MenuProps } from 'antd';
import { 
    SafetyCertificateOutlined,
    FileTextOutlined,
    SettingOutlined,
    PieChartOutlined,
    DownloadOutlined,
    UserOutlined,
    LogoutOutlined,
    AuditOutlined,
    DashboardOutlined
} from '@ant-design/icons';

import { useAuthStore, type UserRole } from './store/useAuthStore';
import { useUIStore, type FontSizeLevel } from './store/useUIStore';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import NotificationBell from './components/NotificationBell';
import { getRoleDisplayName } from './utils/roleLabel';

// ★ 修正：使用者反映不希望外部測試人員在畫面上看到任何 API 錯誤提示或匯出按鈕。原本
// 這裡掛載的 <ApiErrorWatcher /> 彈出提示元件與 Header 上的匯出按鈕已移除；診斷紀錄
// 現在改為在 apiErrorLogger.ts 寫入當下，直接背景靜默送到 Google 表單通知開發團隊
// (見 utils/googleFormReporter.ts)，全程不影響畫面。

import Login from './features/login/Login';
import ProfileSettings from './features/settings/ProfileSettings';
import SystemPreferences from './features/settings/SystemPreferences';
import AuditLogHub from './features/audit_logs/AuditLogHub';
import AdminDashboard from './features/admin/AdminDashboard';
import { Dashboard } from './features/dashboard/Dashboard';
import MainLayout from './features/workspace/MainLayout';
import { validateProgression } from './features/workspace/validateProgression';
import { useIdleTimeout } from './features/settings/useIdleTimeout';

import { scaleFontSize, FONT_SCALE_BASE_PX } from './utils/fontScale';
const { Header, Content, Sider } = Layout;

const DEFAULT_SESSION_TIMEOUT_MINUTES = 1800;
const MIN_STEP_INDEX = 0;
const MAX_STEP_INDEX = 3;

// 側邊選單展開寬度隨字體大小級距調整之基準像素值，避免大字級時選單文字與圖示重疊或被截斷
const SIDER_WIDTH_LEVEL_PX_MAP: Record<FontSizeLevel, number> = {
    small: 200,
    medium: 200,
    large: 240,
    extraLarge: 280,
};

// 字體大小級距對應之基準像素值 (符合規範 e) 避免使用不易理解之數字)
const FONT_SIZE_LEVEL_PX_MAP: Record<FontSizeLevel, number> = {
    small: 12,
    medium: 16,
    large: 24,
    extraLarge: 28,
};

// ★ QA 回饋：跨步驟驗證失敗的提示訊息內容較長，若沿用 message（頂部小提示條）預設僅 3 秒
// 且無法手動關閉，使用者常常來不及看完就自動消失。改用 notification（右下角通知卡片，
// 本身內建可手動關閉的 X 按鈕）並拉長顯示秒數，一併解決「顯示時間太短」與
// 「無法手動關閉」兩項回饋。
const STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS = 8;

// ★ QA 回饋：同一份回饋也適用於全站其他 message.error()/warning()/success() 提示 (登入、
// 上傳、匯入 JSON 等)，這些並非本次新增，但同樣預設只顯示 antd 內建的 3 秒。message 元件
// 本身不支援手動關閉按鈕 (與 notification 不同)，故這裡改用全域設定拉長顯示秒數，並開啟
// pauseOnHover：使用者將滑鼠移到提示上時會暫停倒數計時，等於間接讓使用者能「按自己需要
// 的時間閱讀完」，作為 message 元件沒有關閉按鈕時的替代方案。
const GLOBAL_MESSAGE_TOAST_AUTO_CLOSE_SECONDS = 6;

// ★ 修正：內部錯誤卡片測試面板 (見 Step4_Result.tsx) 原本只靠網址列的 ?debugErrors=1
// 判斷是否顯示。但本頁使用 React Router，切換步驟／頁面時 (見下方 InnerApp 內多處
// executeNavigationAction(`/workspace?step=${...}`)) 一律會把網址參數整串換成只剩
// ?step=N，把使用者自己加上去的 debugErrors=1 沖掉；加上「步驟三」規定一次只能往前跳
// 一步 (見 validateProgression.ts 的 MAX_ALLOWED_STEP_JUMP_COUNT)，也不可能直接把網址
// 改成 /workspace?step=4 就跳過去，一定得先照順序切換到第四步，中途至少會經過一次上述
// 的網址覆寫。於是使用者依照原本的說明操作，網址參數必定在抵達第四步前就已經消失。
// 修正方式：改用瀏覽器 localStorage 記住這個旗標，不受網址切換影響——只要曾經在網址列
// 加上 ?debugErrors=1 並重新整理過一次頁面(讓這段程式碼執行到)，之後不論怎麼切換頁面，
// 旗標都會持續有效，直到使用者改用 ?debugErrors=0 重新整理、或在測試面板按下關閉為止。
// 這段程式碼寫在模組最外層 (而非 useEffect 內)，確保在瀏覽器真正載入這個網址、
// React Router 尚未接手改寫網址前，就已經讀到使用者實際輸入的完整網址參數。
export const DEBUG_ERRORS_LOCAL_STORAGE_KEY = 'ppt_debug_errors_enabled';
try {
    const initialPageLoadUrlSearchParams = new URLSearchParams(window.location.search);
    const debugErrorsUrlParamValue = initialPageLoadUrlSearchParams.get('debugErrors');
    if (debugErrorsUrlParamValue === '1') {
        window.localStorage.setItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY, '1');
    } else if (debugErrorsUrlParamValue === '0') {
        window.localStorage.removeItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY);
    }
} catch (debugFlagLocalStorageErrorPayload) {
    console.warn('讀取/寫入錯誤卡片測試面板旗標失敗:', debugFlagLocalStorageErrorPayload);
}

interface RequireAuthProps {
    children: React.ReactNode;
}

const RequireAuth = ({ children: childComponentsNode }: RequireAuthProps): React.ReactElement => {
    const isUserAuthenticatedStatus = useAuthStore((state) => state.isAuthenticated);
    // ★ 2026-10-27：重新整理頁面後，正向後端接續登入（refresh token 換發）時先顯示載入中，不要立刻踢回登入頁
    const isRestoringSessionStatus = useAuthStore((state) => state.isRestoringSession);
    if (!isUserAuthenticatedStatus && isRestoringSessionStatus) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" />
            </div>
        );
    }
    if (!isUserAuthenticatedStatus) {
        return <Navigate to="/login" replace />;
    }
    return <>{childComponentsNode}</>;
};

interface RBACGuardProps {
    allowedRoles: UserRole[]; 
    redirectPath: string;     
}

const RBACGuard = ({ allowedRoles, redirectPath }: RBACGuardProps): React.ReactElement => {
    const currentUserSessionData = useAuthStore((state) => state.user);
    const { message: globalMessageApi } = AntdApp.useApp();
    const { t: translate } = useTranslation();
    const currentRoleNameString = currentUserSessionData?.role || 'data_owner';
    // ★ 修正：使用者從右上選單「切換測試角色」時，舊頁面的守衛會先看到新角色而誤跳「權限不足」。
    // 只有「進入頁面當下角色就不符」（例如直接輸入網址）才提示；頁面停留期間角色被切換，則靜默導向即可。
    const [roleNameOnMountString] = useState<string>(currentRoleNameString);
    const isRoleSwitchedWhileMountedStatus = roleNameOnMountString !== currentRoleNameString;

    useEffect(() => {
        if (isRoleSwitchedWhileMountedStatus) return;
        if (!allowedRoles.includes(currentRoleNameString as UserRole)) {
            globalMessageApi.error(translate('message.role_blocked', '權限不足：您目前的角色無法存取該頁面，已將您導回專屬工作區。'));
        }
    }, [currentRoleNameString, isRoleSwitchedWhileMountedStatus, allowedRoles, globalMessageApi, translate]);

    if (!allowedRoles.includes(currentRoleNameString as UserRole)) {
        return <Navigate to={redirectPath} replace />;
    }
    return <Outlet />; 
};

const RoleBasedRedirect = (): React.ReactElement => {
    const currentUserSessionData = useAuthStore((state) => state.user);
    return currentUserSessionData?.role === 'admin'
        ? <Navigate to="/admin" replace />
        : <Navigate to="/dashboard" replace />;
};

interface InnerAppProps {
    isDarkMode: boolean; 
}

function InnerApp({ isDarkMode }: InnerAppProps): React.ReactElement {
    const { t: translate } = useTranslation(); 
    const executeNavigationAction = useNavigate();
    const currentLocationData = useLocation();
    const { message: globalMessageApi, modal: globalModalApi, notification: globalNotificationApi } = AntdApp.useApp();

    const currentUserSessionData = useAuthStore((state) => state.user);
    const executeLogoutAction = useAuthStore((state) => state.logout);

    const currentFontSizeLevelValue = useUIStore((state) => state.fontSizeLevel);
    const siderExpandedWidthValue = SIDER_WIDTH_LEVEL_PX_MAP[currentFontSizeLevelValue];

    const sessionTimeoutMinutesValue = useWorkspaceStore((state) => (state as unknown as Record<string, unknown>).sessionTimeout as number) || DEFAULT_SESSION_TIMEOUT_MINUTES;
    const isMaintenanceModeActiveStatus = useWorkspaceStore((state) => (state as unknown as Record<string, unknown>).isMaintenanceMode as boolean) || false;
    // ★ 2026-10-16：mustChangePassword 只在「密碼過期輪替」到期時為 true（已移除首次登入須變更密碼）
    const isPasswordExpiredActiveStatus = useAuthStore((state) => state.user?.mustChangePassword) || false;
    const currentWorkspaceStepIndexValue = useWorkspaceStore((state) => state.currentStep);
    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    
    // ★ 取得我們寫好的 resetWorkspaceAction
    const resetWorkspaceAction = useWorkspaceStore((state) => state.resetWorkspace);

    useIdleTimeout(sessionTimeoutMinutesValue);

    const [searchParamsObject] = useSearchParams();
    const stepQueryParameterString = searchParamsObject.get('step');
    const hasShownPasswordExpireModalRef = useRef<boolean>(false);
    const currentUserRoleNameString = currentUserSessionData?.role || 'data_owner';

    useEffect(() => {
        if (isPasswordExpiredActiveStatus && currentLocationData.pathname !== '/settings/profile') {
            if (!hasShownPasswordExpireModalRef.current) {
                hasShownPasswordExpireModalRef.current = true;
                globalModalApi.warning({
                    title: translate('profile.password_expired_modal_title', '密碼已過期，請先變更'),
                    content: translate('profile.password_expired_desc_rotation', '依系統密碼過期輪替政策，您的密碼已超過有效天數。在變更密碼前，您無法進行其他操作。'),
                    okText: translate('modal.confirm', '立即變更'),
                    keyboard: false,
                    onOk: () => {
                        executeNavigationAction('/settings/profile', { replace: true });
                        hasShownPasswordExpireModalRef.current = false;
                    }
                });
            }
        }
    }, [isPasswordExpiredActiveStatus, currentLocationData.pathname, executeNavigationAction, globalModalApi, translate]);

    useEffect(() => {
        if (isMaintenanceModeActiveStatus && currentUserRoleNameString === 'data_owner') {
            globalModalApi.warning({
                title: translate('admin.maintenance_active_title', '系統維護中'),
                content: translate('admin.maintenance_active_desc', '系統已進入維護模式，僅允許管理員存取。您即將被強制登出。'),
                okText: translate('modal.confirm', '確認'),
                onOk: () => {
                    executeLogoutAction('maintenance');
                    executeNavigationAction('/login');
                }
            });
        }
    }, [isMaintenanceModeActiveStatus, currentUserRoleNameString, executeLogoutAction, globalModalApi, executeNavigationAction, translate]);

    useEffect(() => {
        if (currentLocationData.pathname === '/workspace') {
            if (stepQueryParameterString !== null) {
                const parsedUrlTargetStepIndexValue = Number(stepQueryParameterString) - 1; 
                const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();
                const storeCurrentStepIndexValue = currentWorkspaceStoreStateSnapshot.currentStep;

                if (parsedUrlTargetStepIndexValue >= MIN_STEP_INDEX && parsedUrlTargetStepIndexValue <= MAX_STEP_INDEX && parsedUrlTargetStepIndexValue !== storeCurrentStepIndexValue) {
                    if (parsedUrlTargetStepIndexValue > storeCurrentStepIndexValue) {
                        const validationErrorMessageString = validateProgression(parsedUrlTargetStepIndexValue, storeCurrentStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);
                        if (validationErrorMessageString) {
                            globalNotificationApi.error({
                                message: translate('workspace.step_jump_blocked_title', '無法跳至該步驟'),
                                description: validationErrorMessageString,
                                duration: STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS,
                                placement: 'bottomRight',
                            });
                            executeNavigationAction(`/workspace?step=${storeCurrentStepIndexValue + 1}`, { replace: true });
                            return;
                        }
                    }
                    useWorkspaceStore.setState({ currentStep: parsedUrlTargetStepIndexValue });
                } else if (parsedUrlTargetStepIndexValue < MIN_STEP_INDEX || parsedUrlTargetStepIndexValue > MAX_STEP_INDEX) {
                    executeNavigationAction(`/workspace?step=${storeCurrentStepIndexValue + 1}`, { replace: true });
                }
            } else {
                executeNavigationAction(`/workspace?step=${useWorkspaceStore.getState().currentStep + 1}`, { replace: true });
            }
        }
    }, [stepQueryParameterString, currentLocationData.pathname, executeNavigationAction, globalNotificationApi, translate]);

    const [isSidebarCollapsedStatus, setIsSidebarCollapsedStatus] = useState<boolean>(true);

    const handleLogoutConfirm = (): void => {
        globalModalApi.confirm({
            title: translate('modal.logout_title', '確認登出'),
            content: translate('modal.logout_content', '您確定要登出系統嗎？'),
            okText: translate('modal.confirm_logout', '確認登出'),
            okType: 'danger',
            cancelText: translate('modal.cancel', '取消'),
            onOk: () => {
                executeLogoutAction();
                resetWorkspaceAction();
                globalMessageApi.success(translate('message.logout_success', '已成功登出'));
            }
        });
    };

    // ★ 關鍵：點擊 Logo 的真正還原邏輯
    const handleLogoClick = (): void => {
        if (isPasswordExpiredActiveStatus) {
            globalMessageApi.warning(translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！'));
            return;
        }

        if (currentUserRoleNameString === 'admin') {
            if (currentLocationData.pathname !== '/admin') {
                executeNavigationAction('/admin');
            }
            return;
        }

        // 判斷：尚未上傳任何檔案（無進度可遺失）時，不需跳確認視窗，直接回到主控台
        // ★ 修正：原本在 Step1 且無檔案時直接 return，導致點擊 Logo／麵包屑完全沒有反應
        const currentDataFile = useWorkspaceStore.getState().dataFile;
        if (!currentDataFile) {
            resetWorkspaceAction();
            if (currentLocationData.pathname !== '/dashboard') {
                executeNavigationAction('/dashboard?Dashboard', { replace: true });
            }
            return;
        }

        // 彈出確認視窗，確認後徹底重置資料並回到第 1 步
        globalModalApi.confirm({
            title: translate('modal.warning_title', '系統提示'),
            content: translate('layout.confirm_reset', '確定要放棄當前進度並重新開始嗎？所有資料與設定將被清除。'),
            okText: translate('modal.confirm', '確定'),
            cancelText: translate('modal.cancel', '取消'),
            onOk: () => {
                resetWorkspaceAction(); // 清除所有資料狀態
                executeNavigationAction('/dashboard?Dashboard', { replace: true });
            }
        });
    };

    // ★ 2026-10-27：串接後端會員系統，角色由後端決定，移除「切換測試角色 (RBAC Demo)」
    const userDropdownMenuConfiguration: MenuProps = {
        items: [
            { key: 'account_header', label: <span style={{ fontWeight: 600, color: '#8c8c8c' }}>{currentUserSessionData?.email}</span>, disabled: true },
            { type: 'divider' },
            { key: 'profile', label: translate('menu.profile_settings', '個人設定'), icon: <UserOutlined /> },
            { key: 'preferences', label: translate('menu.system_preferences', '系統設定'), icon: <SettingOutlined /> },
        ],
        onClick: (menuClickEventObj) => {
            if (isPasswordExpiredActiveStatus && menuClickEventObj.key !== 'profile') {
                globalMessageApi.warning(translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！'));
                return;
            }

            if (menuClickEventObj.key === 'profile') {
                executeNavigationAction('/settings/profile');
            } else if (menuClickEventObj.key === 'preferences') {
                executeNavigationAction('/settings/preferences');
            }
        }
    };

    const handleSidebarStepChange = (targetSidebarStepIndexValue: number): void => {
        if (isPasswordExpiredActiveStatus) {
            globalMessageApi.warning(translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！'));
            return;
        }

        if (currentLocationData.pathname === '/workspace' && targetSidebarStepIndexValue === currentWorkspaceStepIndexValue) {
            return;
        }

        const currentWorkspaceStoreStateSnapshot = useWorkspaceStore.getState();

        if (targetSidebarStepIndexValue > currentWorkspaceStepIndexValue) {
            const progressionValidationErrorMessageString = validateProgression(targetSidebarStepIndexValue, currentWorkspaceStepIndexValue, currentWorkspaceStoreStateSnapshot, translate);

            if (progressionValidationErrorMessageString) {
                globalNotificationApi.warning({
                    message: translate('workspace.step_jump_blocked_title', '無法跳至該步驟'),
                    description: progressionValidationErrorMessageString,
                    duration: STEP_VALIDATION_NOTIFICATION_AUTO_CLOSE_SECONDS,
                    placement: 'bottomRight',
                });
                executeNavigationAction(`/workspace?step=${currentWorkspaceStepIndexValue + 1}`, { replace: true });
                return;
            }
        }

        useWorkspaceStore.setState({ currentStep: targetSidebarStepIndexValue });
        executeNavigationAction(`/workspace?step=${targetSidebarStepIndexValue + 1}`);
    };

    const themeDynamicColorsConfiguration = {
        bgLayout: isDarkMode ? '#121214' : '#f0f2f5',
        bgComponent: isDarkMode ? '#1a1a1e' : '#ffffff',
        bgCard: isDarkMode ? '#1e1e2f' : '#ffffff',
        border: isDarkMode ? '#2d2d34' : '#f0f0f0',
        textMain: isDarkMode ? '#ffffff' : '#1f1f1f',
        textMuted: isDarkMode ? '#aaaaaa' : '#8c8c8c',
    };

    const siderMenuConfigurationItemsList: MenuProps['items'] = currentUserRoleNameString === 'data_owner' 
        ? [
            { key: '0', icon: <FileTextOutlined />, label: translate('menu.data_import', '資料匯入'), onClick: () => handleSidebarStepChange(0) },
            { key: '1', icon: <SettingOutlined />, label: translate('menu.attribute_mapping', '屬性分類'), onClick: () => handleSidebarStepChange(1) },
            { key: '2', icon: <PieChartOutlined />, label: translate('menu.privacy_settings', '隱私設定'), onClick: () => handleSidebarStepChange(2) },
            { key: '3', icon: <DownloadOutlined />, label: translate('menu.preview_export', '預覽匯出'), onClick: () => handleSidebarStepChange(3) },
            { type: 'divider' },
            { key: 'audit', icon: <AuditOutlined />, label: translate('menu.audit_log', '歷史審計憑證 (Audit Log)'), onClick: () => {
                if (isPasswordExpiredActiveStatus) {
                    globalMessageApi.warning(translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！'));
                    return;
                }
                executeNavigationAction('/audit');
            }}
        ]
        : [
            { key: 'admin_dashboard', icon: <DashboardOutlined />, label: translate('menu.admin_dashboard', '系統管理大廳'), onClick: () => {
                if (isPasswordExpiredActiveStatus) {
                    globalMessageApi.warning(translate('profile.must_change_password', '請先完成密碼變更，才能使用系統功能！'));
                    return;
                }
                executeNavigationAction('/admin');
            }}
        ];

    const calculatedActiveSidebarSelectedKeysList = (() => {
        if (currentLocationData.pathname === '/admin') return ['admin_dashboard'];
        if (currentLocationData.pathname === '/audit') return ['audit'];
        if (currentLocationData.pathname === '/workspace') return [String(currentWorkspaceStepIndexValue)];
        return [];
    })();

    return (
        <>
            <style>{`
                @keyframes slideLeftFadeIn {
                    0% { opacity: 0; transform: translateX(40px); }
                    100% { opacity: 1; transform: translateX(0); }
                }
                .step-content-animator {
                    animation: slideLeftFadeIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
                }
                .v-card-style {
                    background: ${themeDynamicColorsConfiguration.bgCard} !important;
                    border: ${isDarkMode ? 'none' : `1px solid ${themeDynamicColorsConfiguration.border}`} !important;
                    box-Shadow: ${isDarkMode ? '0 4px 20px 0 rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'} !important;
                }
                .ant-menu-dark {
                    background: transparent !important;
                }
            `}</style>

            <Layout style={{ minHeight: '100vh', background: themeDynamicColorsConfiguration.bgLayout, transition: 'background 0.3s' }}>
                <Sider
                    collapsible
                    collapsed={isSidebarCollapsedStatus}
                    onCollapse={(collapsedStatusValue) => setIsSidebarCollapsedStatus(collapsedStatusValue)}
                    theme={isDarkMode ? "dark" : "light"}
                    width={siderExpandedWidthValue}
                    style={{ background: themeDynamicColorsConfiguration.bgComponent, borderRight: `1px solid ${themeDynamicColorsConfiguration.border}`, transition: 'background 0.3s, width 0.2s' }}
                >
                    {/* ★ 修正：將 Logo 正確綁定 handleLogoClick */}
                    <div 
                        style={{ 
                            height: 64, 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: isSidebarCollapsedStatus ? 'center' : 'flex-start', 
                            padding: '0 24px', 
                            gap: '12px', 
                            marginBottom: '16px',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s'
                        }}
                        onClick={handleLogoClick}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                        title={currentUserRoleNameString === 'admin' ? translate('menu.admin_dashboard', '系統管理大廳') : translate('header.back_to_select_mode', '重新開始並清空資料')}
                    >
                        <SafetyCertificateOutlined style={{ fontSize: scaleFontSize(24), color: '#3f51b5' }} />
                        {!isSidebarCollapsedStatus && <span style={{ fontWeight: 'bold', fontSize: scaleFontSize(16), letterSpacing: '1px', color: themeDynamicColorsConfiguration.textMain }}>PRIVACY APP V1.0</span>}
                    </div>
                    
                    <Menu 
                        theme={isDarkMode ? "dark" : "light"} 
                        selectedKeys={calculatedActiveSidebarSelectedKeysList} 
                        mode="inline" 
                        style={{ background: 'transparent' }}
                        items={siderMenuConfigurationItemsList}
                    />
                </Sider>

                <Layout style={{ background: 'transparent' }}>
                    <Header style={{ background: themeDynamicColorsConfiguration.bgComponent, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${themeDynamicColorsConfiguration.border}`, transition: 'background 0.3s' }}>
                        
                        <div style={{ color: themeDynamicColorsConfiguration.textMuted, fontSize: scaleFontSize(14), display: 'flex', alignItems: 'center' }}>
                            
                            {/* ★ 修正：將上方麵包屑的工具包也綁定 handleLogoClick */}
                            <span 
                                style={{ 
                                    color: themeDynamicColorsConfiguration.textMain, 
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    transition: 'color 0.2s'
                                }}
                                onClick={handleLogoClick}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#3f51b5'}
                                onMouseLeave={(e) => e.currentTarget.style.color = themeDynamicColorsConfiguration.textMain}
                                title={translate('header.back_to_select_mode', '重新開始並清空資料')}
                            >
                                {translate('header.privacy_toolkit', '隱私強化工具包')}
                            </span>

                            {currentUserRoleNameString === 'data_owner' && currentLocationData.pathname === '/audit' && (
                                <span style={{ color: '#3f51b5', fontWeight: 'bold' }}>
                                    &nbsp;/ {translate('header.audit_log', '歷史審計紀錄與憑證管理')}
                                </span>
                            )}

                            {currentUserRoleNameString === 'data_owner' && currentLocationData.pathname === '/workspace' && (
                                <>
                                    <span style={{ margin: '0 4px' }}>/</span>
                                    <span style={{ color: '#3f51b5', fontWeight: 'bold' }}>
                                        {currentWorkspaceStepIndexValue > MIN_STEP_INDEX 
                                            ? (currentPrivacyModeTypeStr === 'k-anonymity' ? translate('header.k_anonymity', 'K-匿名化') : translate('header.differential_privacy', '差分隱私')) 
                                            : translate('header.select_mode', '選擇模式')}
                                    </span>
                                </>
                            )}
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                            {/* ★ 2026-10-07：鈴鐺改為動態公告面板（左圖示｜中訊息｜右時間），見 components/NotificationBell.tsx */}
                            <NotificationBell iconColor={themeDynamicColorsConfiguration.textMuted} />

                            <Dropdown menu={userDropdownMenuConfiguration} placement="bottomRight" trigger={['click']}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '8px' }} className="user-profile-hover">
                                    <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#3f51b5' }} />
                                    <span style={{ color: themeDynamicColorsConfiguration.textMain, fontSize: scaleFontSize(14), fontWeight: 500 }}>{currentUserSessionData?.name || 'Admin.Test'}</span>
                                    <Tag color="purple" style={{ margin: 0, borderRadius: '10px', fontSize: scaleFontSize(11) }}>
                                        {getRoleDisplayName(currentUserRoleNameString)}
                                    </Tag>
                                </div>
                            </Dropdown>

                            <LogoutOutlined 
                                style={{ fontSize: scaleFontSize(18), color: '#f5222d', cursor: 'pointer' }} 
                                title={translate('header.logout', '登出')} 
                                onClick={handleLogoutConfirm}
                            />
                        </div>
                    </Header>

                    <Content style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ width: '100%', margin: '0 auto', flex: 1 }}>
                            <Outlet />
                        </div>
                    </Content>
                </Layout>
            </Layout>
        </>
    );
}

export default function App(): React.ReactElement {
    const isDarkModeActiveStatus = useUIStore((state) => state.isDarkMode);
    const executeSetIsDarkModeAction = useUIStore((state) => state.setIsDarkMode);
    const currentLanguageCodeString = useUIStore((state) => state.language);
    const currentFontSizeLevelValue = useUIStore((state) => state.fontSizeLevel);
    const { i18n: i18nInstanceObj } = useTranslation();

    useEffect(() => {
        i18nInstanceObj.changeLanguage(currentLanguageCodeString);
    }, [currentLanguageCodeString, i18nInstanceObj]);

    useEffect(() => {
        const systemThemeMediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemThemeChangeEvent = (e: MediaQueryListEvent) => executeSetIsDarkModeAction(e.matches);
        systemThemeMediaQueryList.addEventListener('change', handleSystemThemeChangeEvent);
        return () => systemThemeMediaQueryList.removeEventListener('change', handleSystemThemeChangeEvent);
    }, [executeSetIsDarkModeAction]);

    useEffect(() => {
        document.documentElement.style.setProperty('--font-size-base', `${FONT_SIZE_LEVEL_PX_MAP[currentFontSizeLevelValue]}px`);
        // 全站寫死的字級（scaleFontSize）以「中」為 1 等比例縮放
        document.documentElement.style.setProperty('--font-scale', String(FONT_SIZE_LEVEL_PX_MAP[currentFontSizeLevelValue] / FONT_SCALE_BASE_PX));
    }, [currentFontSizeLevelValue]);

    const getAntdLocale = () => {
        switch (currentLanguageCodeString) {
            case 'en_US': return enUS;
            case 'zh_TW':
            default: return zhTW;
        }
    };

    return (
        <ConfigProvider 
            locale={getAntdLocale()} 
            theme={{ 
                algorithm: isDarkModeActiveStatus ? theme.darkAlgorithm : theme.defaultAlgorithm,
                token: {
                    colorPrimary: '#3f51b5',
                    fontSize: FONT_SIZE_LEVEL_PX_MAP[currentFontSizeLevelValue],
                    // ★ 2026-10-08：按鈕／輸入框／下拉的高度跟著字體等比例放大（以「中」字級對應 AntD 預設 32px 高為基準）。
                    //   原本高度固定，字體調大後文字會超出按鈕（例如 Step3 DP「改為『秒』」小按鈕）。
                    //   small／large 高度由 AntD 依此自動推算（×0.75／×1.25）。
                    controlHeight: Math.round(32 * FONT_SIZE_LEVEL_PX_MAP[currentFontSizeLevelValue] / FONT_SIZE_LEVEL_PX_MAP.medium),
                    borderRadius: 12,
                    boxShadow: isDarkModeActiveStatus 
                        ? '0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12)'
                        : '0px 2px 4px -1px rgba(0,0,0,0.06), 0px 4px 6px -1px rgba(0,0,0,0.1)'
                }
            }}
        >
            <AntdApp
                style={{ background: 'transparent', width: '100%' }}
                message={{ duration: GLOBAL_MESSAGE_TOAST_AUTO_CLOSE_SECONDS, pauseOnHover: true }}
            >
                <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        {/* ★ 2026-10-16：移除「忘記密碼」「申請使用權限」頁（同步後端會員系統：帳號由管理員建立、密碼由管理員重設） */}
                        <Route path="/" element={<RequireAuth><InnerApp isDarkMode={isDarkModeActiveStatus} /></RequireAuth>}>
                            <Route index element={<RoleBasedRedirect />} />
                            <Route element={<RBACGuard key="rbac-guard-data-owner" allowedRoles={['data_owner']} redirectPath="/admin" />}>
                                <Route path="dashboard" element={<Dashboard />} />
                                <Route path="workspace" element={<MainLayout />} />
                                <Route path="audit" element={<AuditLogHub />} />
                            </Route>
                            <Route element={<RBACGuard key="rbac-guard-admin" allowedRoles={['admin']} redirectPath="/workspace?step=1" />}>
                                <Route path="admin" element={<AdminDashboard />} />
                            </Route>
                            <Route path="settings/profile" element={<ProfileSettings />} />
                            <Route path="settings/preferences" element={<SystemPreferences />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Route>
                    </Routes>
                </BrowserRouter>
            </AntdApp>
        </ConfigProvider>
    );
}