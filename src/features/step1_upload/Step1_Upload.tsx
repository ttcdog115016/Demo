/**
 * ============================================================================
 * 檔案名稱 (File): Step1_Upload.tsx
 * 模組功能 (Description): 去識別化工作流第一步：資料集上傳與脫敏保護模式選擇組件 (支援 CSV/Excel 解析與前 1000 筆資料預覽)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { useState } from 'react';
import { Card, Upload, Table, Alert, Button, Space, Typography, Popconfirm, theme, App as AntdApp, Radio, Row, Col, Spin } from 'antd';
import { InboxOutlined, FileExcelOutlined, DeleteOutlined, CheckCircleFilled, SafetyCertificateOutlined, CodeSandboxOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const { Dragger } = Upload;

const { Text, Title } = Typography;

/**
 * 預設解析常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * 
 * 詳細說明:
 * - MAX_FILE_SIZE_LIMIT_MB: 允許上傳之單一檔案大小上限 (500 MB)，防止前端記憶體溢出。
 * - PARSE_PREVIEW_ROW_LIMIT: PapaParse 執行時，僅解析前 1000 筆資料供預覽，加速大檔案載入。
 * - UI_CARD_PREVIEW_ROW_LIMIT: 成功載入後，UI 表格上實際僅顯示前 5 筆紀錄。
 * - BYTES_PER_MEGABYTE: 1 MB 對應的 Bytes 數 (1024 * 1024 = 1048576)。
 */
const MAX_FILE_SIZE_LIMIT_MB = 500;
const PARSE_PREVIEW_ROW_LIMIT = 1000;
const UI_CARD_PREVIEW_ROW_LIMIT = 5;
const BYTES_PER_MEGABYTE = 1048576; // 1024 * 1024 

/**
 * 函數名稱: Step1_Upload
 * 函數功能: 渲染步驟一介面，提供拖頁上傳 CSV/Excel 檔案、預覽資料欄位與前幾筆資料內容，並供用戶選擇 K-Anonymity 或 Differential Privacy 脫敏保護模式。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 步驟一 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被主流程 Step 精靈組件載入渲染
 *   - 訂閱與更新 useWorkspaceStore 中的 columns, previewData, privacyMode 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Step1_Upload(): React.ReactElement 
{
    // 取得 Ant Design 當前主題 Token
    const { token } = theme.useToken();
    
    // 主題深色模式狀態標記 (判斷背景色是否非純白) (符合規範 g)
    const isDarkModeActive = token.colorBgContainer !== '#ffffff';

    // 字級縮放比例：本組件內文字/圖示尺寸原以 AntD 預設基準字級 (14px) 設計，
    // 此處依當前全域字體大小設定等比例縮放，避免與其他採用 token.fontSize 之元件 (如下方預覽表格) 呈現不一致的文字大小
    const fontSizeScaleFactor = token.fontSize / 14;

    const { message: messageApi } = AntdApp.useApp();

    const { t: translate } = useTranslation();
    
    // ============================================================================
    // 全域狀態訂閱區塊 (來自 useWorkspaceStore)
    // 規範對照: 符合變數撰寫參考 b) 確認全域變數之含義、c) 確認全域變數與程序之關係
    // ============================================================================
    
    // 欄位名稱陣列 (如 ['ID', 'Name', 'Age'])
    const datasetColumnsList = useWorkspaceStore(
        (state) => state.columns
    );

    // 解析後之前端預覽用資料列集合
    const datasetPreviewRowsList = useWorkspaceStore(
        (state) => state.previewData
    );

    // 使用者上傳之檔案原始名稱
    const uploadedFileName = useWorkspaceStore(
        (state) => state.fileName
    );

    // 寫入解析後資料至 Store 之 Action 函式
    const setFileDataAction = useWorkspaceStore(
        (state) => state.setFileData
    );

    // 寫入原始實體檔案至 Store 之 Action 函式
    const setDataFileAction = useWorkspaceStore(
        (state) => state.setDataFile
    );

    // 清除 Store 中檔案快取資料之 Action 函式
    const clearFileDataAction = useWorkspaceStore(
        (state) => state.clearFileData
    );
    
    // 當前所選之去識別化保護模式 ('k-anonymity' | 'differential-privacy')
    const currentPrivacyMode = useWorkspaceStore(
        (state) => state.privacyMode
    );

    // 設定保護模式之 Action 函式
    const setPrivacyModeAction = useWorkspaceStore(
        (state) => state.setPrivacyMode
    );

    // 觸發進入下一步 (Step 2) 之 Action 函式
    const executeNextStepAction = useWorkspaceStore(
        (state) => state.nextStep
    );
    
    // 元件區域狀態宣告 (符合規範 g)
    const [isFileUploading, setIsFileUploading] = useState<boolean>(false); // 上傳/解析中之載入狀態開關

    // 判斷當前是否已有載入完成之資料集 (依據欄位陣列是否存在且長度大於 0) (符合規範 g)
    const isDatasetLoadedStatus = datasetColumnsList && datasetColumnsList.length > 0;

    /**
     * 函數名稱: handleFileUpload
     * 函數功能: 驗證上傳檔案大小限制 (最大 500MB)，並使用 PapaParse Web Worker 背景解析 CSV 檔案前 1000 筆資料寫入全域 Store。
     */
    const handleFileUpload = (targetFileObj: File): boolean => 
    {
        // 防呆處理：驗證檔案大小是否超出 MAX_FILE_SIZE_LIMIT_MB 限制
        const isFileSizeValid = targetFileObj.size / BYTES_PER_MEGABYTE < MAX_FILE_SIZE_LIMIT_MB;

        if (!isFileSizeValid) 
        {
            messageApi.error(
                translate('step1.error_file_too_large', '檔案大小不能超過 500MB！')
            );
            return false;
        }

        // 將通過驗證的實體 File 物件存入 Zustand Store 中，供後續 API 使用
        setDataFileAction(targetFileObj);

        // 啟動解析載入動畫
        setIsFileUploading(true);
        
        // 呼叫 PapaParse 進行 CSV 解析
        Papa.parse(
            targetFileObj, 
            {
                header: true,         // 將第一行視為欄位名稱
                skipEmptyLines: true, // 略過空白行
                worker: false,         // 啟用 Web Worker 背景處理，避免阻塞 UI 執行緒
                preview: PARSE_PREVIEW_ROW_LIMIT, // 僅解析前 N 筆，確保效能
                complete: (parseResultsObj) => 
                {
                    // 解析成功之處理邏輯
                    const parsedColumnsListArray = parseResultsObj.meta.fields || [];
                    const rawDataRowsArray = parseResultsObj.data as Record<string, unknown>[];

                    // 將解析結果與檔案名稱寫入全域 WorkspaceStore
                    setFileDataAction(parsedColumnsListArray, rawDataRowsArray, targetFileObj.name);
                    
                    // 若尚未選擇任何保護模式，則預設設定為 'k-anonymity'
                    if (!currentPrivacyMode) 
                    {
                        setPrivacyModeAction('k-anonymity');
                    }
                    
                    // 關閉解析載入動畫
                    setIsFileUploading(false);

                    // 提示使用者解析成功
                    messageApi.success(
                        translate('step1.parse_success', { file: targetFileObj.name })
                    );
                },
                error: (parseErrorObj: Error) => 
                {
                    // 解析失敗之處理邏輯 (符合規範 g: 處理錯誤回傳)
                    setIsFileUploading(false);

                    messageApi.error(
                        translate('step1.parse_error', { error: parseErrorObj.message })
                    );
                }
            }
        );

        // 回傳 false 阻斷 Antd 預設上傳機制
        return false;
    };

    /**
     * 函數名稱: handleClear
     * 函數功能: 清除目前已載入之資料集與全域 Store 中的檔案快取，還原至初始拖頁上傳狀態。
     */
    const handleClear = (): void => 
    {
        // 呼叫 Action 清空 WorkspaceStore 中之檔案相關資料
        clearFileDataAction();

        messageApi.success(
            translate('step1.clear_success')
        );
    };

    // 依據全域 Store 中儲存之欄位名稱陣列，動態產生 Ant Design Table 所需之 columns 配置
    const dataTableColumnsConfig = datasetColumnsList.map(
        (columnNameString) => 
        (
            {
                title: columnNameString,
                dataIndex: columnNameString,
                key: columnNameString,
                ellipsis: true, // 若內容過長以刪節號顯示
            }
        )
    );

    // 從全域 Store 截取前 UI_CARD_PREVIEW_ROW_LIMIT (5) 筆資料，供前端表格預覽展示
    const displayPreviewRowsList = datasetPreviewRowsList.slice(0, UI_CARD_PREVIEW_ROW_LIMIT);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* 依據 isDatasetLoadedStatus 條件渲染：未載入時顯示上傳區塊，已載入時顯示資料預覽與模式選擇 */}
            {!isDatasetLoadedStatus ? (
                <>
                    <Card variant="borderless" style={{ background: token.colorBgContainer, borderRadius: 12 }}>
                        {/* 將原本的 message 改為 title 以修正 AntD Warning */}
                        <Alert 
                            title={translate('step1.upload_title')} 
                            description={translate('step1.upload_desc')} 
                            type="info" 
                            showIcon 
                            style={{ marginBottom: 24 }}
                        />

                        <Spin spinning={isFileUploading} description="解析檔案中...">
                            {/* Ant Design Dragger 拖曳上傳區塊 */}
                            <Dragger 
                                name="file" 
                                multiple={false} 
                                accept=".csv, .xlsx, .xls"
                                beforeUpload={handleFileUpload}
                                showUploadList={false} // 不顯示預設之上傳列表 (因採自訂解析與預覽流程)
                                disabled={isFileUploading}
                                style={{ padding: '40px 0', background: isDarkModeActive ? '#141414' : '#fafafa' }}
                            >
                                <p className="ant-upload-drag-icon">
                                    <InboxOutlined style={{ color: token.colorPrimary, fontSize: 48 * fontSizeScaleFactor }} />
                                </p>

                                <Title level={4} style={{ marginTop: 16 }}>
                                    {translate('step1.drag_text')}
                                </Title>

                                <Text type="secondary">
                                    {translate('step1.drag_hint')}
                                </Text>
                            </Dragger>
                        </Spin>
                    </Card>
                </>
            ) : (
                <>
                    {/* 資料集已就緒提示 Banner (將原本的 message 改為 title 以修正 AntD Warning) */}
                    <Alert 
                        title={
                            <Space>
                                <CheckCircleFilled style={{ color: '#52c41a' }} />
                                <span style={{ fontWeight: 600 }}>{translate('step1.dataset_ready')}</span>
                            </Space>
                        }
                        description={translate('step1.dataset_desc')}
                        type="success"
                        style={{ border: `1px solid #b7eb8f` }}
                    />

                    {/* 預覽資料表格卡片 */}
                    <Card 
                        title={
                            <Space>
                                <FileExcelOutlined style={{ color: '#52c41a', fontSize: 18 * fontSizeScaleFactor }} />
                                <span>{translate('step1.current_file')} <Text strong>{uploadedFileName || 'dataset.csv'}</Text></span>
                            </Space>
                        } 
                        extra={
                            <Popconfirm 
                                title={translate('step1.clear_confirm')} 
                                onConfirm={handleClear} 
                                okText={translate('step1.btn_clear')} 
                                cancelText={translate('step1.btn_cancel')}
                            >
                                <Button danger icon={<DeleteOutlined />}>{translate('step1.reupload')}</Button>
                            </Popconfirm>
                        }
                        variant="borderless" 
                        style={{ background: token.colorBgContainer }}
                        styles={{ body: { padding: 0 } }}
                    >
                        <div style={{ padding: '16px 24px', background: isDarkModeActive ? '#1d1d1d' : '#f8fafc', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                            <Text strong style={{ fontSize: token.fontSize, color: token.colorTextSecondary }}>
                                {translate('step1.preview_title', { count: displayPreviewRowsList.length })}
                            </Text>
                        </div>

                        <Table 
                            dataSource={displayPreviewRowsList} 
                            columns={dataTableColumnsConfig} 
                            pagination={false} 
                            rowKey={(dataRowRecordItem) => JSON.stringify(dataRowRecordItem)}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            style={{ background: isDarkModeActive ? '#141414' : '#fff' }}
                        />
                    </Card>

                    {/* 脫敏保護模式選擇卡片 */}
                    <Card variant="borderless" style={{ background: token.colorBgContainer }}>
                        <div style={{ fontWeight: 600, fontSize: 16 * fontSizeScaleFactor, marginBottom: '16px', color: token.colorText }}>
                            {translate('step1.select_mode')}
                        </div>

                        <Radio.Group 
                            onChange={(radioChangeEventObj) => setPrivacyModeAction(radioChangeEventObj.target.value)} 
                            value={currentPrivacyMode} 
                            style={{ width: '100%' }}
                        >
                            {/* ★ 修正：加入 display: 'flex' 與 alignItems: 'stretch' 確保左右等高 */}
                            <Row gutter={16} style={{ display: 'flex', alignItems: 'stretch' }}>
                                {/* K-Anonymity 選項 */}
                                <Col span={12} style={{ display: 'flex' }}>
                                    <Radio.Button 
                                        value="k-anonymity" 
                                        className="privacy-mode-btn"
                                        style={{ flex: 1 }} // 讓按鈕填滿整個 Col 的高度
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                            <SafetyCertificateOutlined style={{ fontSize: 24 * fontSizeScaleFactor, color: currentPrivacyMode === 'k-anonymity' ? token.colorPrimary : token.colorTextSecondary }} />
                                            <span style={{ fontSize: 16 * fontSizeScaleFactor, fontWeight: 'bold' }}>{translate('step1.k_anon_title')}</span>
                                        </div>

                                        <div style={{ fontSize: 13 * fontSizeScaleFactor, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                                            {translate('step1.k_anon_desc')}
                                        </div>
                                    </Radio.Button>
                                </Col>

                                {/* Differential Privacy 選項 */}
                                <Col span={12} style={{ display: 'flex' }}>
                                    <Radio.Button 
                                        value="differential-privacy" 
                                        className="privacy-mode-btn"
                                        style={{ flex: 1 }} // 讓按鈕填滿整個 Col 的高度
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                            <CodeSandboxOutlined style={{ fontSize: 24 * fontSizeScaleFactor, color: currentPrivacyMode === 'differential-privacy' ? token.colorPrimary : token.colorTextSecondary }} />
                                            <span style={{ fontSize: 16 * fontSizeScaleFactor, fontWeight: 'bold' }}>{translate('step1.dp_title')}</span>
                                        </div>

                                        <div style={{ fontSize: 13 * fontSizeScaleFactor, color: token.colorTextDescription, whiteSpace: 'normal', lineHeight: 1.5, textAlign: 'left' }}>
                                            {translate('step1.dp_desc')}
                                        </div>
                                    </Radio.Button>
                                </Col>
                            </Row>
                        </Radio.Group>
                    </Card>
                    
                    {/* 前往下一步 (Step 2) 按鈕 */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <Button 
                            type="primary" 
                            size="large" 
                            onClick={executeNextStepAction}
                            disabled={!currentPrivacyMode}
                        >
                            {translate('step1.next_mapping')}
                        </Button>
                    </div>
                </>
            )}

            {/* 元件專屬樣式覆寫 */}
            <style>{`
                .ant-table-thead > tr > th {
                    background: ${isDarkModeActive ? '#262626' : '#fafafa'} !important;
                    color: ${token.colorTextSecondary} !important;
                }
                .privacy-mode-btn {
                    /* ★ 修正：將 height 改為 100% 確保填滿容器高度 */
                    height: 100% !important;
                    width: 100% !important;
                    padding: 20px !important;
                    border-radius: 12px !important;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    transition: all 0.3s ease;
                }
                .ant-radio-button-wrapper-checked.privacy-mode-btn {
                    border-color: ${token.colorPrimary} !important;
                    background: ${isDarkModeActive ? 'rgba(63, 81, 181, 0.15)' : 'rgba(63, 81, 181, 0.05)'} !important;
                }
                .ant-radio-button-wrapper-checked.privacy-mode-btn::before {
                    background-color: transparent !important;
                }
            `}</style>
        </div>
    );
}