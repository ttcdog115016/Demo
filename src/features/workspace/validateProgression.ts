import { useTranslation } from 'react-i18next';
import { usePrivacyStore } from '../../store/usePrivacyStore';

type TranslateFunction = ReturnType<typeof useTranslation>['t'];
type PrivacyState = ReturnType<typeof usePrivacyStore.getState>;

interface ColumnConfig {
  privacyRole?: string;
  isDpEnabled?: boolean;
  dpDataType?: string;
  dpLowerBound?: number | string;
  dpUpperBound?: number | string;
  dpAllowedCategories?: string | string[];
  [key: string]: unknown;
}

export const validateProgression = (
  targetStep: number, 
  currentStep: number, 
  storeState: PrivacyState, 
  t: TranslateFunction
): string | null => {
  if (targetStep > currentStep + 1) {
    return t('message.no_skip', '為確保資料安全，請循序漸進完成設定，勿跳躍步驟');
  }

  const { columns, privacyMode } = storeState;
  const typedColumns = columns as unknown as ColumnConfig[];

  if (targetStep >= 1) {
    if (!typedColumns || typedColumns.length === 0) return t('message.require_import', '請先完成資料匯入！');
    if (!privacyMode) return t('message.require_mode', '請先選擇隱私防護模式！');
  }

  if (targetStep >= 2) {
    if (privacyMode === 'k-anonymity') {
      const hasQI = typedColumns.some((c) => c.privacyRole === 'quasi-identifier');
      if (!hasQI) return t('message.require_qi', '請至少將一個欄位標記為「準識別碼」才能進入隱私設定！');
    } else {
      const hasIncompleteDP = typedColumns.some((c) => {
        if (!c.isDpEnabled) return false; 
        if (!c.dpDataType) return true; 
        
        if (c.dpDataType === 'numeric') {
          const invalidLower = c.dpLowerBound === undefined || c.dpLowerBound === null || String(c.dpLowerBound).trim() === '';
          const invalidUpper = c.dpUpperBound === undefined || c.dpUpperBound === null || String(c.dpUpperBound).trim() === '';
          return invalidLower || invalidUpper;
        } else {
          return !c.dpAllowedCategories || (Array.isArray(c.dpAllowedCategories) ? c.dpAllowedCategories.length === 0 : String(c.dpAllowedCategories).trim() === '');
        }
      });

      if (hasIncompleteDP) return t('message.dp_incomplete', '設定不完整：請先完成所有紅框標示的參數設定，才能進入下一步！');
    }
  }

  if (targetStep >= 3) {
    if (!storeState.isStepValid && currentStep === 2) {
      return storeState.stepErrorMessage || t('message.complete_current_step', '請完成當前步驟的必填設定');
    }
  }

  return null; 
};