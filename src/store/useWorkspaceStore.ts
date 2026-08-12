import { create } from 'zustand';

export interface PreprocessingRule {
  action: string;
  param: string;
}

export interface DPField {
  id: string; // 🌟 補上這個漏掉的 id！
  fieldName: string;
  enabled?: boolean;
  fieldType?: string;
  epsilon?: number;
  delta?: number;
  mode?: 'epsilon' | 'epsilon-delta';
  lowerBound?: number | string;
  upperBound?: number | string;
  allowedCategories?: string;
  maxLength?: number;
}

export interface Step4Cache {
  metrics: {
    singling: { ori: number; ctrl: number; base: number; risk: number };
    linkability: { ori: number; ctrl: number; base: number; risk: number };
    inference: { ori: number; ctrl: number; base: number; risk: number };
    overallRiskPercent: string;
  };
  certificateId: string;
  auditTime: string;
}

interface WorkspaceState {
  // 基礎設定與檔案資料
  currentStep: number;
  privacyMode: 'k-anonymity' | 'differential-privacy' | null;
  columns: string[];
  previewData: Record<string, unknown>[];
  preprocessingRules: Record<string, PreprocessingRule>;
  fileName?: string;
  
  // 核心陣列與物件
  columnRoles: Record<string, string>;
  columnTypes: Record<string, string>;
  dpFields: DPField[];
  
  // 快取
  step4Cache: Step4Cache | null;
  lastRunParamsHash: string | null;

  // 驗證狀態
  isStepValid: boolean;
  stepErrorMessage: string | null;
  
  // ==========================================
  // 🌟 K-Anonymity 進階參數
  // ==========================================
  kValue: number;
  lValue: number;
  tValue: number;
  maxSuppression: number;
  suppressionMethod: string;
  limitExceededAction: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kAnonymityFields: any[]; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kAnonymityHierarchies: any[];
  fieldAttributes: Record<string, unknown>;
  maskingRules: Record<string, unknown>;
  generalizationRules: Record<string, unknown>;
  categoricalHierarchies: Record<string, unknown>;
  numericBins: Record<string, unknown>;
  temporalHierarchies: Record<string, unknown>;

  // ==========================================
  // 🌟 Differential Privacy 進階參數
  // ==========================================
  queryCount: number;
  targetDelta: number;
  budgetLimitEpsilon: number;
  outOfBoundsStrategy: string;

  // Actions
  setPrivacyMode: (mode: 'k-anonymity' | 'differential-privacy') => void;
  setPreprocessingRules: (rules: Record<string, PreprocessingRule>) => void;
  nextStep: () => void;
  prevStep: () => void;
  setStep4Cache: (cache: Step4Cache, hash: string) => void;
  setFileData: (columns: string[], data: Record<string, unknown>[], fileName: string) => void;
  clearFileData: () => void;
  setStepValidation: (isValid: boolean, msg: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  // 初始化基礎資料
  currentStep: 0,
  privacyMode: null,
  columns: [],
  previewData: [],
  preprocessingRules: {},
  fileName: undefined,
  columnRoles: {},
  columnTypes: {},
  dpFields: [],
  step4Cache: null,
  lastRunParamsHash: null,

  // 初始化驗證狀態
  isStepValid: true,
  stepErrorMessage: null,

  // 🌟 初始化 K-Anonymity 參數
  kValue: 5, 
  lValue: 2,
  tValue: 0.15,
  maxSuppression: 5,
  suppressionMethod: 'row_suppression',
  limitExceededAction: 'stop_and_error',

  kAnonymityFields: [],
  kAnonymityHierarchies: [],
  fieldAttributes: {},
  maskingRules: {},
  generalizationRules: {},
  categoricalHierarchies: {},
  numericBins: {},
  temporalHierarchies: {},
  
  // 🌟 初始化 DP 參數
  queryCount: 1,
  targetDelta: 0.0001,
  budgetLimitEpsilon: 10,
  outOfBoundsStrategy: 'clip',
  
  // Actions 實作
  setPrivacyMode: (mode) => set({ privacyMode: mode }),
  setPreprocessingRules: (rules) => set({ preprocessingRules: rules }),
  nextStep: () => set((state) => ({ currentStep: state.currentStep + 1 })),
  prevStep: () => set((state) => ({ currentStep: state.currentStep - 1 })),
  setStep4Cache: (cache, hash) => set({ step4Cache: cache, lastRunParamsHash: hash }),
  
  setFileData: (columns, data, fileName) => set({ columns, previewData: data, fileName }),
  clearFileData: () => set({ 
    columns: [], 
    previewData: [], 
    fileName: undefined, 
    privacyMode: null, 
    preprocessingRules: {} 
  }),
  setStepValidation: (isValid, msg) => set({ isStepValid: isValid, stepErrorMessage: msg }),
}));