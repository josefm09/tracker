import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';

// Store
import { useAuthStore } from './store/authStore';
import { useLocationStore } from './store/locationStore';

// Components
import Layout from './components/Layout';
import LoadingScreen from './components/LoadingScreen';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import MapPage from './pages/MapPage';
import FamilyPage from './pages/FamilyPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';

// Services
import { initializeSocket } from './services/socketService';

// Create theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#007AFF',
      light: '#5AC8FA',
      dark: '#0051D5',
    },
    secondary: {
      main: '#FF3B30',
      light: '#FF6B6B',
      dark: '#D32F2F',
    },
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1C1C1E',
      secondary: '#6C6C70',
    },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h4: {
      fontWeight: 600,
      fontSize: '1.75rem',
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.5rem',
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.25rem',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 12,
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#1C1C1E',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        },
      },
    },
  },
});

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Public Route component (redirect to dashboard if authenticated)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  const { initializeAuth, user, isAuthenticated } = useAuthStore();
  const { initializeGeolocation } = useLocationStore();

  useEffect(() => {
    // Initialize authentication
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    // Initialize socket connection when authenticated
    if (isAuthenticated && user) {
      initializeSocket(user.accessToken);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    // Initialize geolocation when authenticated
    if (isAuthenticated) {
      initializeGeolocation();
    }
  }, [isAuthenticated, initializeGeolocation]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <div className="App">
            <Routes>
              {/* Public Routes */}
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <LoginPage />
                  </PublicRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicRoute>
                    <RegisterPage />
                  </PublicRoute>
                }
              />

              {/* Protected Routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="map" element={<MapPage />} />
                <Route path="family" element={<FamilyPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>

              {/* Catch all route */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {/* Global Toast Notifications */}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                  borderRadius: '12px',
                },
                success: {
                  style: {
                    background: '#10B981',
                  },
                  iconTheme: {
                    primary: '#fff',
                    secondary: '#10B981',
                  },
                },
                error: {
                  style: {
                    background: '#EF4444',
                  },
                  iconTheme: {
                    primary: '#fff',
                    secondary: '#EF4444',
                  },
                },
              }}
            />
          </div>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
