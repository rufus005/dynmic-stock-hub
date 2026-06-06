import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserAccount } from '@/lib/types';
import { db, USERS_PATH } from '@/lib/firebase';
import { ref, onValue } from 'firebase/database';
import { safeSetPath, safeSoftDeletePath, safeUpdatePaths } from '@/lib/firebaseProtection';

interface AuthContextType {
  isAuthenticated: boolean;
  currentUser: UserAccount | null;
  users: UserAccount[];
  login: (username: string, password: string) => string | null;
  logout: () => void;
  addUser: (user: Omit<UserAccount, 'id'>) => void;
  updateUser: (id: string, updates: Partial<UserAccount>) => void;
  deleteUser: (id: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const DEFAULT_ADMIN: UserAccount = {
  id: 'admin-default',
  username: 'Dynamic',
  password: 'Ismail@123',
  role: 'admin',
  branchId: null,
};

function isVisibleUser(value: unknown): value is UserAccount {
  return !!value && typeof value === 'object' && (value as { deleted?: boolean }).deleted !== true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('dynamic_auth') === 'true';
  });
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    const stored = sessionStorage.getItem('dynamic_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [users, setUsers] = useState<UserAccount[]>([]);

  // Listen to /users in Firebase
  useEffect(() => {
    const usersRef = ref(db, USERS_PATH);
    const unsubscribe = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      if (!data || (Array.isArray(data) && data.length === 0)) {
        // Seed default admin
        const seeded = [DEFAULT_ADMIN];
        safeSetPath(`${USERS_PATH}/${DEFAULT_ADMIN.id}`, DEFAULT_ADMIN, { action: 'set', entity: 'users', reason: 'seed default admin' });
        setUsers(seeded);
      } else {
        const list = (Array.isArray(data) ? data : Object.values(data as Record<string, unknown>))
          .filter(isVisibleUser);
        setUsers(list);
      }
    });
    return () => unsubscribe();
  }, []);

  const login = (username: string, password: string): string | null => {
    const found = users.find(u => u.username === username && u.password === password);
    if (found) {
      setIsAuthenticated(true);
      setCurrentUser(found);
      sessionStorage.setItem('dynamic_auth', 'true');
      sessionStorage.setItem('dynamic_user', JSON.stringify(found));
      return null;
    }
    return 'Invalid Username or Password';
  };

  const logout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    sessionStorage.removeItem('dynamic_auth');
    sessionStorage.removeItem('dynamic_user');
  };

  const addUser = (user: Omit<UserAccount, 'id'>) => {
    const newUser: UserAccount = { ...user, id: crypto.randomUUID() };
    const updated = [...users, newUser];
    setUsers(updated);
    safeSetPath(`${USERS_PATH}/${newUser.id}`, newUser, { action: 'set', entity: 'users' });
  };

  const updateUser = (id: string, updates: Partial<UserAccount>) => {
    const updated = users.map(u => u.id === id ? { ...u, ...updates } : u);
    setUsers(updated);
    const childUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
      acc[`${USERS_PATH}/${id}/${key}`] = value;
      return acc;
    }, {} as Record<string, unknown>);
    safeUpdatePaths(childUpdates, { action: 'update', entity: 'users' });
  };

  const deleteUser = (id: string) => {
    const updated = users.filter(u => u.id !== id);
    setUsers(updated);
    safeSoftDeletePath(`${USERS_PATH}/${id}`, { entity: 'users', reason: 'user soft delete' });
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, currentUser, users, login, logout, addUser, updateUser, deleteUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
