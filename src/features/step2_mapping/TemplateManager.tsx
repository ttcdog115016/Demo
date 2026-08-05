import { useState } from 'react';
import { Button, List, Input, Form, Tag, Popconfirm, Space, Typography, App as AntdApp, Modal } from 'antd';
import { BookOutlined, PlusOutlined, DeleteOutlined, CheckOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import { usePrivacyStore } from '../../store/usePrivacyStore';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function TemplateManager() {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form] = Form.useForm();
  
  const { message, modal } = AntdApp.useApp();
  const { t } = useTranslation();
  
  const currentMode = usePrivacyStore((state) => state.privacyMode);
  const templates = usePrivacyStore((state) => state.templates);
  const saveTemplate = usePrivacyStore((state) => state.saveTemplate);
  const applyTemplate = usePrivacyStore((state) => state.applyTemplate);
  const deleteTemplate = usePrivacyStore((state) => state.deleteTemplate);

  const handleCreate = (values: { name: string; description?: string }) => {
    saveTemplate(values.name, values.description);
    message.success(t('template.saveSuccess', '已成功將當前 Schema 設定儲存為範本！'));
    form.resetFields();
    setIsCreating(false);
  };

  const executeApply = (id: string, name: string) => {
    applyTemplate(id);
    message.success(`${t('template.applySuccess', '已一鍵套用範本：')}「${name}」`);
    setOpen(false);
  };

  const handleApplyClick = (template: any) => {
    if (currentMode === template.privacyMode) {
      executeApply(template.id, template.name);
      return;
    }

    const templateModeName = template.privacyMode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy';
    const currentModeName = currentMode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy';

    modal.confirm({
      title: t('template.warningTitle', '⚠️ 隱私模式不符提示'),
      icon: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p>{t('template.warningContent1', '您目前選擇的範本屬於')}<strong>「{templateModeName}」</strong>{t('template.warningContent2', '設定，但系統目前處於')}<strong>「{currentModeName}」</strong>{t('template.warningContent3', '模式。')}</p>
          <p>{t('template.warningContent4', '若繼續套用，系統將會自動為您切換模式。是否確認繼續？')}</p>
        </div>
      ),
      okText: t('template.confirmApply', '確認套用並切換'),
      okType: 'primary',
      cancelText: t('template.cancel', '取消套用'),
      onOk() {
        executeApply(template.id, template.name);
      },
    });
  };

  const handleDelete = (id: string) => {
    deleteTemplate(id);
    message.success(t('template.deleteSuccess', '已刪除該範本'));
  };

  return (
    <>
      <Button icon={<BookOutlined />} onClick={() => setOpen(true)} style={{ borderRadius: 8 }}>
        {t('template.buttonText', '範本管理 (Templates)')}
      </Button>

      <Modal
        title={<span><BookOutlined style={{ marginRight: 8, color: '#3f51b5' }} /> {t('template.modalTitle', '專案 Schema 範本庫管理')}</span>}
        open={open}
        onCancel={() => { setOpen(false); setIsCreating(false); form.resetFields(); }}
        footer={null}
        width={680}
      >
        {!isCreating ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text type="secondary">{t('template.instruction', '可一鍵套用預先設定好的欄位清洗與隱私對映規則：')}</Text>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreating(true)} style={{ borderRadius: 8 }}>
                {t('template.saveNew', '將當前設定存為新範本')}
              </Button>
            </div>

            <List
              itemLayout="horizontal"
              dataSource={templates}
              locale={{ emptyText: t('template.emptyText', '尚無儲存的範本。您可以將目前設定儲存為新範本！') }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button 
                      type="link" 
                      icon={<CheckOutlined />} 
                      onClick={() => handleApplyClick(item)} 
                    >
                      {t('template.apply', '套用')}
                    </Button>,
                    <Popconfirm
                      title={t('template.deleteConfirm', '確定要刪除此範本嗎？')}
                      onConfirm={() => handleDelete(item.id)}
                      okText={t('template.delete', '刪除')}
                      cancelText={t('template.cancel', '取消')}
                    >
                      <Button type="link" danger icon={<DeleteOutlined />}>{t('template.delete', '刪除')}</Button>
                    </Popconfirm>
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong style={{ fontSize: 15 }}>{item.name}</Text>
                        <Tag color={item.privacyMode === 'k-anonymity' ? 'blue' : 'purple'}>
                          {item.privacyMode === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy'}
                        </Tag>
                      </Space>
                    }
                    description={
                      <div>
                        <div>{item.description || t('template.noDescription', '無備註說明')}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('template.createDate', '建立日期')}: {item.createdAt}</Text>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        ) : (
          <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
            {/* 🌟 加入了自訂的名稱重複檢查 validator */}
            <Form.Item 
              name="name" 
              label={t('template.nameLabel', '範本名稱')} 
              rules={[
                { required: true, message: t('template.nameRequired', '請輸入範本名稱') },
                () => ({
                  validator(_, value) {
                    if (value && templates.some(t => t.name === value)) {
                      return Promise.reject(new Error(t('template.nameDuplicate', '此範本名稱已存在，請更換名稱')));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <Input placeholder={t('template.namePlaceholder', '例：醫療保險資料集脫敏範本')} />
            </Form.Item>
            
            <Form.Item name="description" label={t('template.descLabel', '備註說明 (選填)')}>
              <Input.TextArea rows={3} placeholder={t('template.descPlaceholder', '例：將 ID 完全遮蔽，Age 作為 QI，Fare 進行區間化...')} />
            </Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <Button onClick={() => { setIsCreating(false); form.resetFields(); }}>{t('template.cancel', '取消')}</Button>
              <Button type="primary" htmlType="submit">{t('template.confirmSave', '確認儲存')}</Button>
            </div>
          </Form>
        )}
      </Modal>
    </>
  );
}