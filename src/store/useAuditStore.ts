import { create } from 'zustand';

export interface AuditLogItem {
  id: string;
  certificateId: string;
  fileName: string;
  privacyMode: string;
  operator: string;
  operatorRole: string;
  auditTime: string;
  parameters: string; // 🌟 補上遺漏的 parameters 屬性
  singlingRisk: string;
  linkabilityRisk: string;
  inferenceRisk: string;
  overallRisk: string;
  status: 'passed' | 'failed';
}

interface AuditState {
  auditLogs: AuditLogItem[];
  addAuditLog: (log: Omit<AuditLogItem, 'id'>) => void;
}

export const useAuditStore = create<AuditState>((set) => ({
  auditLogs: [],
  addAuditLog: (log) => set((state) => ({
    // 自動補上 id
    auditLogs: [{ ...log, id: crypto.randomUUID() }, ...state.auditLogs]
  })),
}));