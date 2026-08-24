/**
 * ============================================================================
 * 檔案名稱 (File): TemplateManager.tsx
 * 模組功能 (Description): 專案 Schema 範本庫管理組件 (提供將目前欄位對映與脫敏規則儲存為範本、一鍵套用範本、跨保護模式警示切換與刪除範本功能)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) 說明性檔案與原始檔案開頭註記
 * ============================================================================
 */

import React, { useState, useCallback } from 'react';
import { Button, List, Input, Form, Tag, Popconfirm, Space, Typography, App as AntdApp, Modal } from 'antd';
import { BookOutlined, PlusOutlined, DeleteOutlined, CheckOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/**
 * 專案 Schema 範本數據結構介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface TemplateItem 
{
    id: string;          // 範本唯一識別碼 (UUID)
    name: string;        // 範本自訂名稱
    description?: string;// 範本備註說明文字 (選填)
    privacyMode: string; // 範本所屬保護模式 ('k-anonymity' | 'differential-privacy')
    createdAt: string;   // 範本建立日期字串
}

/**
 * WorkspaceStore 擴充介面 (消除 any 警告)
 */
interface ExtendedWorkspaceStore {
    privacyMode: 'k-anonymity' | 'differential-privacy' | null;
    templates?: TemplateItem[];
    saveTemplate?: (name: string, description?: string) => void;
    applyTemplate?: (id: string) => void;
    deleteTemplate?: (id: string) => void;
}

// ★ 核心修復 1：宣告模組層級的固定空陣列，防止 getSnapshot 傳回新陣列位址觸發無窮重繪
const EMPTY_TEMPLATES_ARRAY: TemplateItem[] = [];

/**
 * 函數名稱: TemplateManager
 * 函數功能: 渲染範本庫管理 Modal 彈窗，提供使用者快速將當前脫敏配置存為新範本、瀏覽與搜尋歷史範本、套用範本規則（含模式不符警告 Modal），以及刪除廢棄範本。
 */
export default function TemplateManager(): React.ReactElement 
{
    // 彈窗開關與新增模式狀態宣告
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
    const [isCreatingNewTemplate, setIsCreatingNewTemplate] = useState<boolean>(false);

    const [templateFormInstance] = Form.useForm();
    
    const { message: messageApi, modal: modalApi } = AntdApp.useApp();
    const { t: translate } = useTranslation();
    
    // ★ 核心修復 2：穩定 Zustand Selectors，絕不在 Selector 內創建實體 [], {} 或進行複雜邏輯
    const currentPrivacyModeString = useWorkspaceStore(
        (state) => state.privacyMode
    );

    const historicalTemplatesList = useWorkspaceStore(
        useCallback(
            (state: unknown) => (state as ExtendedWorkspaceStore).templates || EMPTY_TEMPLATES_ARRAY,
            []
        )
    );

    const saveTemplateAction = useWorkspaceStore(
        useCallback(
            (state: unknown) => (state as ExtendedWorkspaceStore).saveTemplate,
            []
        )
    );

    const applyTemplateAction = useWorkspaceStore(
        useCallback(
            (state: unknown) => (state as ExtendedWorkspaceStore).applyTemplate,
            []
        )
    );

    const deleteTemplateAction = useWorkspaceStore(
        useCallback(
            (state: unknown) => (state as ExtendedWorkspaceStore).deleteTemplate,
            []
        )
    );

    /**
     * 處理將當前 Schema 與脫敏規則存為新範本之表單送出事件。
     */
    const handleCreate = (formValuesObj: { name: string; description?: string }): void => 
    {
        if (saveTemplateAction) {
            saveTemplateAction(formValuesObj.name, formValuesObj.description);
        }

        messageApi.success(
            translate('template.saveSuccess', '已成功將當前 Schema 設定儲存為範本！')
        );

        templateFormInstance.resetFields();
        setIsCreatingNewTemplate(false);
    };

    /**
     * 執行範本套用 Action，並彈出成功提示訊息與關閉 Modal 視窗。
     */
    const executeApply = (templateIdStr: string, templateNameStr: string): void => 
    {
        if (applyTemplateAction) {
            applyTemplateAction(templateIdStr);
        }

        messageApi.success(`${translate('template.applySuccess', '已一鍵套用範本：')}「${templateNameStr}」`);
        setIsTemplateModalOpen(false);
    };

    /**
     * 點擊範本清單「套用」按鈕時，比對當前模式與範本模式。若模式不符合，顯示二次確認警告 Modal。
     */
    const handleApplyClick = (targetTemplateItem: TemplateItem): void => 
    {
        if (currentPrivacyModeString === targetTemplateItem.privacyMode) 
        {
            executeApply(targetTemplateItem.id, targetTemplateItem.name);
            return;
        }

        const templateModeDisplayName = targetTemplateItem.privacyMode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy';
        const currentModeDisplayName = currentPrivacyModeString === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy';

        modalApi.confirm({
            title: translate('template.warningTitle', '⚠️ 隱私模式不符提示'),
            icon: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
            content: (
                <div>
                    <p>{translate('template.warningContent1', '您目前選擇的範本屬於')}<strong>「{templateModeDisplayName}」</strong>{translate('template.warningContent2', '設定，但系統目前處於')}<strong>「{currentModeDisplayName}」</strong>{translate('template.warningContent3', '模式。')}</p>
                    <p>{translate('template.warningContent4', '若繼續套用，系統將會自動為您切換模式。是否確認繼續？')}</p>
                </div>
            ),
            okText: translate('template.confirmApply', '確認套用並切換'),
            okType: 'primary',
            cancelText: translate('template.cancel', '取消套用'),
            onOk() 
            {
                executeApply(targetTemplateItem.id, targetTemplateItem.name);
            },
        });
    };

    /**
     * 依據 ID 刪除選定之 Schema 範本。
     */
    const handleDelete = (targetTemplateIdStr: string): void => 
    {
        if (deleteTemplateAction) {
            deleteTemplateAction(targetTemplateIdStr);
        }

        messageApi.success(
            translate('template.deleteSuccess', '已刪除該範本')
        );
    };

    return (
        <>
            {/* 觸發 Modal 開啟之外部按鈕 */}
            <Button icon={<BookOutlined />} onClick={() => setIsTemplateModalOpen(true)} style={{ borderRadius: 8 }}>
                {translate('template.buttonText', '範本管理 (Templates)')}
            </Button>

            {/* 範本庫管理 Modal 彈窗 */}
            <Modal
                title={<span><BookOutlined style={{ marginRight: 8, color: '#3f51b5' }} /> {translate('template.modalTitle', '專案 Schema 範本庫管理')}</span>}
                open={isTemplateModalOpen}
                onCancel={
                    () => 
                    { 
                        setIsTemplateModalOpen(false); 
                        setIsCreatingNewTemplate(false); 
                        templateFormInstance.resetFields(); 
                    }
                }
                footer={null}
                width={680}
            >
                {!isCreatingNewTemplate ? (
                    /* 模式一：範本瀏覽與套用清單 */
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <Text type="secondary">{translate('template.instruction', '可一鍵套用預先設定好的欄位清洗與隱私對映規則：')}</Text>

                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreatingNewTemplate(true)} style={{ borderRadius: 8 }}>
                                {translate('template.saveNew', '將當前設定存為新範本')}
                            </Button>
                        </div>

                        <List
                            itemLayout="horizontal"
                            dataSource={historicalTemplatesList}
                            locale={{ emptyText: translate('template.emptyText', '尚無儲存的範本。您可以將目前設定儲存為新範本！') }}
                            renderItem={
                                (templateItemRecord) => 
                                (
                                    <List.Item
                                        actions={
                                            [
                                                <Button 
                                                    key="apply"
                                                    type="link" 
                                                    icon={<CheckOutlined />} 
                                                    onClick={() => handleApplyClick(templateItemRecord)} 
                                                >
                                                    {translate('template.apply', '套用')}
                                                </Button>,
                                                <Popconfirm
                                                    key="delete"
                                                    title={translate('template.deleteConfirm', '確定要刪除此範本嗎？')}
                                                    onConfirm={() => handleDelete(templateItemRecord.id)}
                                                    okText={translate('template.delete', '刪除')}
                                                    cancelText={translate('template.cancel', '取消')}
                                                >
                                                    <Button type="link" danger icon={<DeleteOutlined />}>{translate('template.delete', '刪除')}</Button>
                                                </Popconfirm>
                                            ]
                                        }
                                    >
                                        <List.Item.Meta
                                            title={
                                                <Space>
                                                    <Text strong style={{ fontSize: 15 }}>{templateItemRecord.name}</Text>
                                                    <Tag color={templateItemRecord.privacyMode === 'k-anonymity' ? 'blue' : 'purple'}>
                                                        {templateItemRecord.privacyMode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy'}
                                                    </Tag>
                                                </Space>
                                            }
                                            description={
                                                <div>
                                                    <div>{templateItemRecord.description || translate('template.noDescription', '無備註說明')}</div>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>{translate('template.createDate', '建立日期')}: {templateItemRecord.createdAt}</Text>
                                                </div>
                                            }
                                        />
                                    </List.Item>
                                )
                            }
                        />
                    </div>
                ) : (
                    /* 模式二：存為新範本表單 */
                    <Form form={templateFormInstance} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
                        <Form.Item 
                            name="name" 
                            label={translate('template.nameLabel', '範本名稱')} 
                            rules={
                                [
                                    { required: true, message: translate('template.nameRequired', '請輸入範本名稱') },
                                    () => (
                                        {
                                            validator(_, inputTemplateNameValue) 
                                            {
                                                if (inputTemplateNameValue && historicalTemplatesList.some(templateItem => templateItem.name === inputTemplateNameValue)) 
                                                {
                                                    return Promise.reject(
                                                        new Error(translate('template.nameDuplicate', '此範本名稱已存在，請更換名稱'))
                                                    );
                                                }

                                                return Promise.resolve();
                                            },
                                        }
                                    ),
                                ]
                            }
                        >
                            <Input placeholder={translate('template.namePlaceholder', '例：醫療保險資料集脫敏範本')} />
                        </Form.Item>
                        
                        <Form.Item name="description" label={translate('template.descLabel', '備註說明 (選填)')}>
                            <Input.TextArea rows={3} placeholder={translate('template.descPlaceholder', '例：將 ID 完全遮蔽，Age 作為 QI，Fare 進行區間化...')} />
                        </Form.Item>
                        
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <Button 
                                onClick={
                                    () => 
                                    { 
                                        setIsCreatingNewTemplate(false); 
                                        templateFormInstance.resetFields(); 
                                    }
                                }
                            >
                                {translate('template.cancel', '取消')}
                            </Button>

                            <Button type="primary" htmlType="submit">{translate('template.confirmSave', '確認儲存')}</Button>
                        </div>
                    </Form>
                )}
            </Modal>
        </>
    );
}