import { describe, it, expect, beforeEach } from 'vitest';
import { usePrivacyStore } from '../../store/usePrivacyStore';

describe('usePrivacyStore - Template Management', () => {
  // 每次測試前重置 store 狀態
  beforeEach(() => {
    usePrivacyStore.setState({
      templates: [],
      privacyMode: 'differential-privacy', // 預設模式
    });
  });

  it('應該能成功新增範本 (saveTemplate)', () => {
    const { saveTemplate } = usePrivacyStore.getState();
    
    saveTemplate('測試範本01', '這是一個測試備註');
    
    const { templates } = usePrivacyStore.getState();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('測試範本01');
    expect(templates[0].description).toBe('這是一個測試備註');
    expect(templates[0].id).toBeDefined(); // 確保有產生 ID
  });

  it('應該能成功刪除範本 (deleteTemplate)', () => {
    const store = usePrivacyStore.getState();
    store.saveTemplate('要被刪除的範本', '');
    
    const templateId = usePrivacyStore.getState().templates[0].id;
    usePrivacyStore.getState().deleteTemplate(templateId);
    
    expect(usePrivacyStore.getState().templates).toHaveLength(0);
  });
});