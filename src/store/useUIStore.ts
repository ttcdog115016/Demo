import { create } from 'zustand';

interface UIState {
  isDarkMode: boolean;
  language: string;
  setIsDarkMode: (isDark: boolean) => void;
  setLanguage: (lang: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
  language: 'zh_TW',
  setIsDarkMode: (isDark) => set({ isDarkMode: isDark }),
  setLanguage: (lang) => set({ language: lang }),
}));