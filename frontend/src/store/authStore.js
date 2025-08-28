import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiService } from '../services/apiService';
import toast from 'react-hot-toast';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,

      // Actions
      login: async (email, password, deviceInfo = {}) => {
        try {
          const response = await apiService.post('/auth/login', {
            email,
            password,
            deviceInfo: {
              platform: 'web',
              appVersion: '1.0.0',
              ...deviceInfo,
            },
          });

          const { user, accessToken, refreshToken } = response.data;

          set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });

          // Set auth header for future requests
          apiService.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

          toast.success(`Welcome back, ${user.firstName}!`);
          return { success: true };
        } catch (error) {
          const message = error.response?.data?.message || 'Login failed';
          toast.error(message);
          return { success: false, error: message };
        }
      },

      register: async (userData) => {
        try {
          const response = await apiService.post('/auth/register', userData);

          const { user, accessToken, refreshToken } = response.data;

          set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });

          // Set auth header for future requests
          apiService.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

          toast.success(`Welcome to FamilyTracker, ${user.firstName}!`);
          return { success: true };
        } catch (error) {
          const message = error.response?.data?.message || 'Registration failed';
          toast.error(message);
          return { success: false, error: message };
        }
      },

      logout: async () => {
        try {
          await apiService.post('/auth/logout');
        } catch (error) {
          console.error('Logout API error:', error);
        } finally {
          // Clear state regardless of API call success
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
          });

          // Remove auth header
          delete apiService.defaults.headers.common['Authorization'];

          toast.success('Logged out successfully');
        }
      },

      refreshAuth: async () => {
        const { refreshToken } = get();
        
        if (!refreshToken) {
          set({ isLoading: false });
          return false;
        }

        try {
          const response = await apiService.post('/auth/refresh', {
            refreshToken,
          });

          const { accessToken, user } = response.data;

          set({
            user,
            accessToken,
            isAuthenticated: true,
            isLoading: false,
          });

          // Set auth header for future requests
          apiService.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

          return true;
        } catch (error) {
          console.error('Token refresh failed:', error);
          
          // Clear invalid tokens
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
          });

          delete apiService.defaults.headers.common['Authorization'];
          return false;
        }
      },

      initializeAuth: async () => {
        const { accessToken, refreshToken } = get();

        if (!accessToken || !refreshToken) {
          set({ isLoading: false });
          return;
        }

        // Set auth header
        apiService.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

        // Try to get current user info
        try {
          const response = await apiService.get('/auth/me');
          const { user } = response.data;

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          // If getting user info fails, try to refresh token
          const refreshSuccess = await get().refreshAuth();
          
          if (!refreshSuccess) {
            set({ isLoading: false });
          }
        }
      },

      updateUser: (userData) => {
        set((state) => ({
          user: {
            ...state.user,
            ...userData,
          },
        }));
      },

      changePassword: async (currentPassword, newPassword) => {
        try {
          await apiService.put('/auth/change-password', {
            currentPassword,
            newPassword,
          });

          toast.success('Password changed successfully');
          return { success: true };
        } catch (error) {
          const message = error.response?.data?.message || 'Failed to change password';
          toast.error(message);
          return { success: false, error: message };
        }
      },

      verifyEmail: async () => {
        try {
          await apiService.post('/auth/verify-email');

          set((state) => ({
            user: {
              ...state.user,
              emailVerified: true,
            },
          }));

          toast.success('Email verified successfully');
          return { success: true };
        } catch (error) {
          const message = error.response?.data?.message || 'Failed to verify email';
          toast.error(message);
          return { success: false, error: message };
        }
      },

      // Computed values
      isEmailVerified: () => {
        const { user } = get();
        return user?.emailVerified || false;
      },

      isPhoneVerified: () => {
        const { user } = get();
        return user?.phoneVerified || false;
      },

      getUserFullName: () => {
        const { user } = get();
        return user ? `${user.firstName} ${user.lastName}` : '';
      },

      getUserInitials: () => {
        const { user } = get();
        if (!user) return '';
        return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Setup axios interceptors for automatic token refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

apiService.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          return apiService(originalRequest);
        }).catch((err) => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshSuccess = await useAuthStore.getState().refreshAuth();
        
        if (refreshSuccess) {
          const { accessToken } = useAuthStore.getState();
          processQueue(null, accessToken);
          originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
          return apiService(originalRequest);
        } else {
          processQueue(error, null);
          return Promise.reject(error);
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
