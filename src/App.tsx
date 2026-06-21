import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import BranchPage from "@/pages/BranchPage";
import ReportsPage from "@/pages/ReportsPage";
import AdminSettingsPage from "@/pages/AdminSettingsPage";
import { Toaster } from "sonner";

const queryClient = new QueryClient();

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: 'admin' | 'branch' }) {
  const { isAuthenticated, currentUser } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (requiredRole === 'admin' && currentUser?.role !== 'admin') {
    // Branch user trying to access admin page → redirect to their branch
    return <Navigate to={`/branch/${currentUser?.branchId}`} replace />;
  }
  return <>{children}</>;
}

const AppRoutes = () => {
  const { isAuthenticated, currentUser } = useAuth();

  const getHomeRedirect = () => {
    if (!currentUser) return '/dashboard';
    if (currentUser.role === 'admin') return '/dashboard';
    return `/branch/${currentUser.branchId}`;
  };

  return (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to={getHomeRedirect()} replace /> : <LoginPage />} />
      <Route path="/dashboard" element={<ProtectedRoute requiredRole="admin"><DashboardPage /></ProtectedRoute>} />
      <Route path="/branch/:id" element={<ProtectedRoute><BranchPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute requiredRole="admin"><ReportsPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute requiredRole="admin"><AdminSettingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <DataProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
          <Toaster position="top-right" richColors closeButton />
        </DataProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
