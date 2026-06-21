import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext';
import { LayoutDashboard, FileText, LogOut, Moon, Sun, Settings, Store } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
  const { logout, currentUser } = useAuth();
  const { branches } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem('dynamic_theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('dynamic_theme', dark ? 'dark' : 'light');
  }, [dark]);

  const handleLogout = () => {
    toast.success('Logged out');
    logout();
    navigate('/');
  };

  const isAdmin = currentUser?.role === 'admin';
  const branchName = !isAdmin && currentUser?.branchId
    ? branches.find(b => b.id === currentUser.branchId)?.name || 'My Branch'
    : null;

  const navItems = isAdmin
      ? [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/reports', label: 'Reports', icon: FileText },
        { path: '/settings', label: 'Settings', icon: Settings },
      ]
    : [
        { path: `/branch/${currentUser?.branchId}`, label: branchName || 'My Branch', icon: Store },
      ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to={isAdmin ? '/dashboard' : `/branch/${currentUser?.branchId}`} className="text-xl font-bold text-gradient tracking-wider">DYNAMIC</Link>
          <div className="flex items-center gap-1">
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
            <button
              onClick={() => setDark(!dark)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {title && <h1 className="text-2xl font-bold mb-6">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
