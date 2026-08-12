import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

type TranslateFunction = ReturnType<typeof useTranslation>['t'];
type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

export const validateProgression = (
  targetStep: number, 
  currentStep: number, 
  storeState: WorkspaceState, 
  t: TranslateFunction
): string | null => {
  if (targetStep > currentStep + 1) {
    return t('message.no_skip', '為確保資料安全，請循序漸進完成設定，勿跳躍步驟');
  }

  const { columns, privacyMode, columnRoles, dpFields } = storeState;

  if (targetStep >= 1) {
    if (!columns || columns.length === 0) return t('message.require_import', '請先完成資料匯入！');
    if (!privacyMode) return t('message.require_mode', '請先選擇隱私防護模式！');
  }

  if (targetStep >= 2) {
    if (privacyMode === 'k-anonymity') {
      const roles = Object.values(columnRoles || {});
      const hasQI = roles.some((role) => role === 'Quasi-identifier');
      
      if (!hasQI) return t('message.require_qi', '請至少將一個欄位標記為「準識別碼」才能進入隱私設定！');
      
    } else {
      // 🌟【差分隱私 DP 驗證邏輯修正】
      const typedDpFields: DPField[] = dpFields || [];
      
      // 1. 防呆關卡 1：檢查是否完全沒有選擇/啟用任何 DP 欄位
      const hasActiveDPField = typedDpFields.some(f => f.enabled);
      if (!hasActiveDPField) {
        return t('message.dp_require_at_least_one', '請至少選擇一個欄位啟用差分隱私 (DP) 處理！');
      }
      
      // 2. 防呆關卡 2：檢查所有已啟用的 DP 欄位，參數是否齊全
      const hasIncompleteDP = typedDpFields.some((c) => {
        if (!c.enabled) return false; // 沒啟用的欄位不納入檢查
        
        // 必須選擇資料型態（非 Unknown / 綠色未選擇）
        if (!c.fieldType || c.fieldType === 'Unknown') return true; 
        
        // 數值型態必填：下界與上界
        if (c.fieldType === 'Numeric') {
          const invalidLower = c.lowerBound === undefined || c.lowerBound === null || String(c.lowerBound).trim() === '';
          const invalidUpper = c.upperBound === undefined || c.upperBound === null || String(c.upperBound).trim() === '';
          return invalidLower || invalidUpper;
        } 
        // 類別型態必填：允許的類別清單
        else if (c.fieldType === 'Categorical') {
          return !c.allowedCategories || (Array.isArray(c.allowedCategories) ? c.allowedCategories.length === 0 : String(c.allowedCategories).trim() === '');
        }
        return false;
      });

      if (hasIncompleteDP) {
        return t('message.dp_incomplete', '設定不完整：請先完成所有紅框標示的參數設定，才能進入下一步！');
      }
    }
  }

  if (targetStep >= 3) {
    if (!storeState.isStepValid && currentStep === 2) {
      return storeState.stepErrorMessage || t('message.complete_current_step', '請完成當前步驟的必填設定');
    }
  }

  return null; 
};