import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UserRole = 'admin' | 'data_owner' ;

export interface UserProfile {
  name: string;
  email: string;
  role: UserRole;
}

export interface PrivacyTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  privacyMode: 'k-anonymity' | 'differential-privacy';
  columnRoles: Record<string, string>;
  columnTypes: Record<string, string>;
  preprocessingRules: Record<string, { action: string; param: string }>;
}

export interface DpField {
  id: string;
  fieldName: string;
  fieldType?: string; 
  enabled: boolean;
  epsilon: number;
  delta: number;
  mode: 'epsilon' | 'epsilon-delta';
  equivalentEpsilon?: number;
  sensitivity?: number;
  lowerBound?: number | string;
  upperBound?: number | string;
  allowedCategories?: string;
  maxLength?: number | string;
}

export interface Step3Params {
  kValue?: number;
  maxSuppression?: number;
  lValue?: number;
  tValue?: number;
  suppressionMethod?: 'row' | 'cell';
  limitExceededAction?: string;
  epsilon?: number;
  targetDelta?: number;
  queryCount?: number;
  budgetLimitEpsilon?: number;
  outOfBoundsStrategy?: 'clip' | 'wrap' | 'reflect';
  dpFields?: DpField[]; 
}

export interface UserPermissions {
  canUploadData: boolean;
  canEditRules: boolean;
  canAdjustParams: boolean;
  canExportCSV: boolean;
  canExportReport: boolean;
}

export interface AuditLogItem {
  id: string;
  certificateId: string;
  fileName: string;
  privacyMode: 'k-anonymity' | 'differential-privacy';
  operator: string;
  operatorRole: UserRole;
  auditTime: string;
  parameters: string;
  singlingRisk: string;
  linkabilityRisk: string;
  inferenceRisk: string;
  overallRisk: string;
  status: 'passed' | 'rejected';
}

export interface FieldDef {
  id: string; name: string; type: string; role: string; maskStrategy: string;
  maskKeepChars: number; maskChar: string; hashType: string;      
  genStrategy: string; genParam: number; genMaxLevel: number;  
}

export interface HierarchyTable {
  id: string; fieldName: string; mappings: string[][]; 
}

export interface SimulationMetrics {
  singling: { ori: number; ctrl: number; base: number; risk: number };
  linkability: { ori: number; ctrl: number; base: number; risk: number };
  inference: { ori: number; ctrl: number; base: number; risk: number };
  overallRiskPercent: string;
}

export interface Step4Cache {
  metrics: SimulationMetrics;
  certificateId: string;
  auditTime: string;
}

export interface PrivacyState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  isDarkMode: boolean;
  language: string;
  currentStep: number;
  privacyMode: 'k-anonymity' | 'differential-privacy' | null;
  
  sessionTimeout: number;
  maxFailedLogins: number;
  isMaintenanceMode: boolean;
  isPasswordExpired: boolean; 
  
  enablePasswordExpiry: boolean;
  passwordExpiryDays: number;
  
  setSessionTimeout: (val: number) => void;
  setMaxFailedLogins: (val: number) => void;
  setMaintenanceMode: (val: boolean) => void;
  setPasswordExpired: (expired: boolean) => void; 
  
  updateSecuritySettings: (settings: { 
    sessionTimeout: number; 
    maxFailedLogins: number; 
    isMaintenanceMode: boolean;
    enablePasswordExpiry: boolean;
    passwordExpiryDays: number;
  }) => void;
  
  columns: string[];
  previewData: Record<string, unknown>[];
  fileName: string | null;
  
  columnRoles: Record<string, string>;
  columnTypes: Record<string, string>;
  preprocessingRules: Record<string, { action: string; param: string }>;

  kAnonymityFields: FieldDef[];
  kAnonymityHierarchies: HierarchyTable[];
  fieldAttributes: Record<string, unknown>;
  maskingRules: Record<string, unknown>;
  generalizationRules: Record<string, unknown>;
  categoricalHierarchies: Record<string, unknown>;
  numericBins: Record<string, unknown>;
  temporalHierarchies: Record<string, unknown>;

  isStepValid: boolean;
  stepErrorMessage: string | null;
  setStepValidation: (isValid: boolean, msg?: string | null) => void;
  
  kValue: number;
  maxSuppression: number;
  lValue: number;
  tValue: number;
  suppressionMethod: 'row' | 'cell';
  limitExceededAction: string;

  epsilon: number;
  targetDelta: number;
  queryCount: number;
  budgetLimitEpsilon: number;
  outOfBoundsStrategy: 'clip' | 'wrap' | 'reflect';
  dpFields: DpField[];

  templates: PrivacyTemplate[];

  auditLogs: AuditLogItem[];
  addAuditLog: (log: Omit<AuditLogItem, 'id'>) => void;

  step4Cache: Step4Cache | null;
  lastRunParamsHash: string | null;
  setStep4Cache: (cache: Step4Cache, hash: string) => void;

  getPermissions: () => UserPermissions;
  setUserRole: (role: UserRole) => void;

  login: (userData: { name: string; email: string; role?: UserRole }) => void;
  logout: () => void;
  setIsDarkMode: (isDark: boolean) => void;
  setLanguage: (lang: string) => void;
  setFileData: (columns: string[], data: Record<string, unknown>[], fileName: string) => void;
  clearFileData: () => void;
  setPrivacyMode: (mode: 'k-anonymity' | 'differential-privacy') => void;
  nextStep: () => void;
  prevStep: () => void;

  setKValue: (val: number) => void;
  setMaxSuppression: (val: number) => void;
  setLValue: (val: number) => void;
  setTValue: (val: number) => void;
  setSuppressionMethod: (method: 'row' | 'cell') => void;
  setLimitExceededAction: (action: string) => void;

  setEpsilon: (val: number) => void;
  setTargetDelta: (val: number) => void;
  setQueryCount: (val: number) => void;
  setBudgetLimitEpsilon: (val: number) => void;
  toggleFieldEnable: (fieldName: string, enabled?: boolean) => void;
  
  updateFieldDP(updatedField: Partial<DpField>): void;
  updateFieldDP(fieldName: string, updatedFields: Partial<DpField>): void;
  updateFieldDP<K extends keyof DpField>(fieldName: string, key: K, value?: DpField[K]): void;

  updateStep3Params: (params: Partial<Step3Params>) => void;

  saveTemplate: (name: string, description?: string) => void;
  applyTemplate: (templateId: string) => void;
  deleteTemplate: (templateId: string) => void;
  exportTemplatesJson: () => void;
  importTemplatesJson: (jsonString: string) => boolean;
}

const loadSavedTemplates = (): PrivacyTemplate[] => {
  try {
    const saved = localStorage.getItem('privacy_app_templates');
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('Failed to load templates from localStorage:', error);
    return [];
  }
};

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      isDarkMode: true,
      language: 'zh_TW',
      currentStep: 0,
      privacyMode: null,
      
      sessionTimeout: 15,
      maxFailedLogins: 5,
      isMaintenanceMode: false,
      isPasswordExpired: false, 
      
      enablePasswordExpiry: true,
      passwordExpiryDays: 90,
      
      setSessionTimeout: (val) => set({ sessionTimeout: val }),
      setMaxFailedLogins: (val) => set({ maxFailedLogins: val }),
      setMaintenanceMode: (val) => set({ isMaintenanceMode: val }),
      setPasswordExpired: (val) => set({ isPasswordExpired: val }), 
      updateSecuritySettings: ({ sessionTimeout, maxFailedLogins, isMaintenanceMode, enablePasswordExpiry, passwordExpiryDays }) => 
        set({ sessionTimeout, maxFailedLogins, isMaintenanceMode, enablePasswordExpiry, passwordExpiryDays }),
      
      columns: [],
      previewData: [],
      fileName: null,
      
      columnRoles: {},
      columnTypes: {},
      preprocessingRules: {},

      kAnonymityFields: [],
      kAnonymityHierarchies: [],
      fieldAttributes: {},
      maskingRules: {},
      generalizationRules: {},
      categoricalHierarchies: {},
      numericBins: {},
      temporalHierarchies: {},

      isStepValid: true,
      stepErrorMessage: null,
      setStepValidation: (isValid, msg = null) => set({ isStepValid: isValid, stepErrorMessage: msg }),

      kValue: 5,
      maxSuppression: 10,
      lValue: 2,
      tValue: 0.15,
      suppressionMethod: 'row',
      limitExceededAction: 'stop_and_error',

      epsilon: 1.0,
      targetDelta: 0.0001,
      queryCount: 1,
      budgetLimitEpsilon: 10.0,
      outOfBoundsStrategy: 'clip',
      dpFields: [],

      templates: loadSavedTemplates(),

      auditLogs: [
        {
          id: 'log-1',
          certificateId: 'PAC-1785138781031',
          fileName: 'finance_scenario_v2_test_data.csv',
          privacyMode: 'k-anonymity',
          operator: 'Admin.Test',
          operatorRole: 'admin',
          auditTime: '2026/7/27 下午3:53:01',
          parameters: 'K = 5, Suppression = 10%',
          singlingRisk: '8.2%',
          linkabilityRisk: '10.5%',
          inferenceRisk: '12.1%',
          overallRisk: '12.1%',
          status: 'passed',
        }
      ],

      step4Cache: null,
      lastRunParamsHash: null,
      setStep4Cache: (cache, hash) => set({ step4Cache: cache, lastRunParamsHash: hash }),

      addAuditLog: (log) => set((state) => {
        const isDuplicate = state.auditLogs.some(
          (item) => item.certificateId === log.certificateId
        );
        if (isDuplicate) return state;

        const newLogItem = {
          ...log,
          id: (log as { id?: string }).id || log.certificateId || `log-${Date.now()}`,
        };

        return { 
          auditLogs: [newLogItem, ...state.auditLogs] 
        };
      }),

      getPermissions: () => {
        const role = get().user?.role || 'data_owner';
        return {
          canUploadData: role === 'data_owner',
          canEditRules: role === 'data_owner',
          canAdjustParams: role === 'data_owner',
          canExportCSV: role === 'data_owner',
          canExportReport: role === 'data_owner',
        };
      },

      setUserRole: (role) => set({
        user: {
          name: role === 'admin' ? 'Admin.Test' : 'Data.Owner.A',
          email: role === 'admin' ? 'admin@company.com' : 'owner_a@company.com',
          role
        }
      }),

      login: (userData) => set({ 
        isAuthenticated: true, 
        user: {
          name: userData.name,
          email: userData.email,
          role: userData.role || 'data_owner'
        },
        // 🌟 已恢復正常狀態：登入時預設為「未過期」
        isPasswordExpired: false 
      }),

      logout: () => set({ isAuthenticated: false, user: null }),
      setIsDarkMode: (isDark) => set({ isDarkMode: isDark }),
      setLanguage: (lang) => set({ language: lang }),
      
      setFileData: (columns, data, fileName) => {
        const initialDpFields: DpField[] = columns.map((colName, idx) => ({
          id: `dp-col-${idx}-${Date.now()}`,
          fieldName: colName,
          fieldType: colName.toLowerCase().includes('age') || colName.toLowerCase().includes('fare') ? 'Numeric' : 'Categorical',
          enabled: true,
          epsilon: 1.0,
          delta: 0.0001,
          mode: 'epsilon',
          equivalentEpsilon: 1.0,
          sensitivity: 1.0,
        }));

        set({ 
          columns, 
          previewData: data, 
          fileName,
          columnRoles: columns.reduce((acc: Record<string, string>, col: string) => ({ ...acc, [col]: 'Non-sensitive' }), {}),
          columnTypes: columns.reduce((acc: Record<string, string>, col: string) => ({ ...acc, [col]: '字串' }), {}),
          dpFields: initialDpFields,
          kAnonymityFields: [],
          kAnonymityHierarchies: [],
          fieldAttributes: {},
          maskingRules: {},
          generalizationRules: {},
          categoricalHierarchies: {},
          numericBins: {},
          temporalHierarchies: {},
          step4Cache: null,       
          lastRunParamsHash: null 
        });
      },

      clearFileData: () => set({ 
        columns: [], 
        previewData: [], 
        fileName: null, 
        currentStep: 0, 
        privacyMode: null,
        dpFields: [],
        kAnonymityFields: [],
        kAnonymityHierarchies: [],
        fieldAttributes: {},
        maskingRules: {},
        generalizationRules: {},
        categoricalHierarchies: {},
        numericBins: {},
        temporalHierarchies: {},
        step4Cache: null,         
        lastRunParamsHash: null   
      }),

      setPrivacyMode: (mode) => set({ privacyMode: mode }),
      nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 3) })),
      prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 0) })),

      setKValue: (val) => set({ kValue: val }),
      setMaxSuppression: (val) => set({ maxSuppression: val }),
      setLValue: (val) => set({ lValue: val }),
      setTValue: (val) => set({ tValue: val }),
      setSuppressionMethod: (method) => set({ suppressionMethod: method }),
      setLimitExceededAction: (action) => set({ limitExceededAction: action }),

      setEpsilon: (val) => set({ epsilon: val }),
      setTargetDelta: (val) => set({ targetDelta: val }),
      setQueryCount: (val) => set({ queryCount: val }),
      setBudgetLimitEpsilon: (val) => set({ budgetLimitEpsilon: val }),

      toggleFieldEnable: (fieldName: string, enabled?: boolean) => set((state) => ({
        dpFields: state.dpFields.map((f: DpField) => 
          (f.fieldName === fieldName || f.id === fieldName) 
            ? { ...f, enabled: enabled !== undefined ? enabled : !f.enabled } 
            : f
        )
      })),

      updateFieldDP: (arg1: unknown, arg2?: unknown, arg3?: unknown) => set((state) => {
        if (typeof arg1 === 'object' && arg1 !== null) {
          const updated = arg1 as Partial<DpField>;
          return {
            dpFields: state.dpFields.map((f: DpField) => 
              (f.id === updated.id || f.fieldName === updated.fieldName) ? { ...f, ...updated } : f
            )
          };
        }

        const fieldIdentifier = arg1 as string;

        if (typeof arg2 === 'object' && arg2 !== null) {
          const partialObj = arg2 as Partial<DpField>;
          return {
            dpFields: state.dpFields.map((f: DpField) => 
              (f.fieldName === fieldIdentifier || f.id === fieldIdentifier) ? { ...f, ...partialObj } : f
            )
          };
        }

        const key = arg2 as keyof DpField;
        const value = arg3;
        return {
          dpFields: state.dpFields.map((f: DpField) => {
            if ((f.fieldName === fieldIdentifier || f.id === fieldIdentifier) && key) {
              return { ...f, [key]: value };
            }
            return f;
          })
        };
      }),

      updateStep3Params: (params) => set((state) => ({
        ...state,
        ...params
      })),

      saveTemplate: (name, description) => {
        const state = get();
        const newTemplate: PrivacyTemplate = {
          id: `tmpl-${Date.now()}`,
          name,
          description,
          createdAt: new Date().toLocaleDateString(),
          privacyMode: state.privacyMode || 'k-anonymity',
          columnRoles: state.columnRoles,
          columnTypes: state.columnTypes,
          preprocessingRules: state.preprocessingRules,
        };
        const updated = [newTemplate, ...state.templates];
        try {
          localStorage.setItem('privacy_app_templates', JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to save template to localStorage:', e);
        }
        set({ templates: updated });
      },

      applyTemplate: (templateId) => {
        const { templates, columns } = get();
        const target = templates.find((t: PrivacyTemplate) => t.id === templateId);
        if (!target) return;

        const newRoles: Record<string, string> = {};
        const newTypes: Record<string, string> = {};
        const newRules: Record<string, { action: string; param: string }> = {};

        columns.forEach((col: string) => {
          newRoles[col] = target.columnRoles[col] || 'Non-sensitive';
          newTypes[col] = target.columnTypes[col] || '字串';
          if (target.preprocessingRules[col]) {
            newRules[col] = target.preprocessingRules[col];
          }
        });

        set({
          privacyMode: target.privacyMode,
          columnRoles: newRoles,
          columnTypes: newTypes,
          preprocessingRules: newRules,
        });
      },

      deleteTemplate: (templateId) => {
        const updated = get().templates.filter((t: PrivacyTemplate) => t.id !== templateId);
        try {
          localStorage.setItem('privacy_app_templates', JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to update localStorage:', e);
        }
        set({ templates: updated });
      },

      exportTemplatesJson: () => {
        const { templates } = get();
        const jsonStr = JSON.stringify(templates, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `privacy_templates_export_${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      },

      importTemplatesJson: (jsonString: string) => {
        try {
          const parsed = JSON.parse(jsonString);
          if (!Array.isArray(parsed)) return false;

          const isValid = parsed.every((item: PrivacyTemplate) => item.id && item.name && item.columnRoles);
          if (!isValid) return false;

          const currentTemplates = get().templates;
          const existingIds = new Set(currentTemplates.map((t: PrivacyTemplate) => t.id));
          const newItems = parsed.filter((item: PrivacyTemplate) => !existingIds.has(item.id));
          const updated = [...newItems, ...currentTemplates];

          localStorage.setItem('privacy_app_templates', JSON.stringify(updated));
          set({ templates: updated });
          return true;
        } catch (e) {
          console.error('JSON Import failed:', e);
          return false;
        }
      }
    }),
    {
      name: 'privacy-app-storage', 
      storage: createJSONStorage(() => sessionStorage), 
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        isDarkMode: state.isDarkMode,
        language: state.language,

        sessionTimeout: state.sessionTimeout,
        maxFailedLogins: state.maxFailedLogins,
        isMaintenanceMode: state.isMaintenanceMode,
        isPasswordExpired: state.isPasswordExpired, 
        
        enablePasswordExpiry: state.enablePasswordExpiry,
        passwordExpiryDays: state.passwordExpiryDays,

        currentStep: state.currentStep,
        privacyMode: state.privacyMode,
        fileName: state.fileName,
        columns: state.columns,
        previewData: state.previewData, 
        columnRoles: state.columnRoles,
        columnTypes: state.columnTypes,
        dpFields: state.dpFields,

        kAnonymityFields: state.kAnonymityFields,
        kAnonymityHierarchies: state.kAnonymityHierarchies,
        fieldAttributes: state.fieldAttributes,
        maskingRules: state.maskingRules,
        generalizationRules: state.generalizationRules,
        categoricalHierarchies: state.categoricalHierarchies,
        numericBins: state.numericBins,
        temporalHierarchies: state.temporalHierarchies,
        
        kValue: state.kValue,
        epsilon: state.epsilon,
      }),
    }
  )
);