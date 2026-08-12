import { create } from 'zustand';

export type UserRole = 'admin' | 'data_owner';

interface User {
  name: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  setUserRole: (role: UserRole) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  login: (user) => set({ isAuthenticated: true, user }),
  logout: () => set({ isAuthenticated: false, user: null }),
  setUserRole: (role) => set((state) => ({ 
    user: state.user ? { ...state.user, role } : null 
  })),
}));