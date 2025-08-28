import { create } from 'zustand';
import { apiService } from '../services/apiService';
import { socketService } from '../services/socketService';
import toast from 'react-hot-toast';

export const useLocationStore = create((set, get) => ({
  // State
  currentLocation: null,
  locationHistory: [],
  familyLocations: [],
  isTrackingEnabled: false,
  isGeolocationSupported: false,
  geolocationError: null,
  accuracy: null,
  lastUpdated: null,
  watchId: null,

  // Actions
  initializeGeolocation: () => {
    if (!navigator.geolocation) {
      set({
        isGeolocationSupported: false,
        geolocationError: 'Geolocation is not supported by this browser'
      });
      return;
    }

    set({ isGeolocationSupported: true });

    // Check if location tracking should be enabled
    const { user } = require('./authStore').useAuthStore.getState();
    if (user?.locationSettings?.shareLocation) {
      get().startTracking();
    }
  },

  startTracking: () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        get().handleLocationUpdate(position);
      },
      (error) => {
        get().handleGeolocationError(error);
      },
      options
    );

    set({
      watchId,
      isTrackingEnabled: true,
      geolocationError: null
    });

    toast.success('Location tracking started');
  },

  stopTracking: () => {
    const { watchId } = get();
    
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
    }

    set({
      watchId: null,
      isTrackingEnabled: false
    });

    toast.success('Location tracking stopped');
  },

  handleLocationUpdate: async (position) => {
    const { coords, timestamp } = position;
    
    const locationData = {
      coordinates: {
        latitude: coords.latitude,
        longitude: coords.longitude
      },
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
      timestamp: new Date(timestamp).toISOString(),
      locationMethod: 'gps',
      battery: await get().getBatteryInfo()
    };

    // Update local state
    set({
      currentLocation: locationData,
      accuracy: coords.accuracy,
      lastUpdated: new Date()
    });

    // Send location to server via Socket.IO
    try {
      socketService.emit('location_update', locationData);
    } catch (error) {
      console.error('Failed to send location update:', error);
      
      // Fallback to REST API
      try {
        await apiService.post('/location/update', locationData);
      } catch (apiError) {
        console.error('Failed to update location via API:', apiError);
        toast.error('Failed to update location');
      }
    }
  },

  handleGeolocationError: (error) => {
    let errorMessage = 'Failed to get location';
    
    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMessage = 'Location access denied by user';
        break;
      case error.POSITION_UNAVAILABLE:
        errorMessage = 'Location information unavailable';
        break;
      case error.TIMEOUT:
        errorMessage = 'Location request timed out';
        break;
    }

    set({
      geolocationError: errorMessage,
      isTrackingEnabled: false
    });

    toast.error(errorMessage);
  },

  getBatteryInfo: async () => {
    try {
      if ('getBattery' in navigator) {
        const battery = await navigator.getBattery();
        return {
          level: Math.round(battery.level * 100),
          isCharging: battery.charging
        };
      }
    } catch (error) {
      console.log('Battery API not supported');
    }
    
    return null;
  },

  getCurrentLocation: async () => {
    try {
      const response = await apiService.get('/location/current');
      const { location } = response.data;

      set({ currentLocation: location });
      return location;
    } catch (error) {
      console.error('Failed to get current location:', error);
      return null;
    }
  },

  getLocationHistory: async (startDate, endDate, limit = 100) => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('limit', limit.toString());

      const response = await apiService.get(`/location/history?${params}`);
      const { locations } = response.data;

      set({ locationHistory: locations });
      return locations;
    } catch (error) {
      console.error('Failed to get location history:', error);
      toast.error('Failed to load location history');
      return [];
    }
  },

  getFamilyLocations: async (familyId) => {
    try {
      const response = await apiService.get(`/family/${familyId}/locations`);
      const { locations } = response.data;

      set({ familyLocations: locations });
      return locations;
    } catch (error) {
      console.error('Failed to get family locations:', error);
      toast.error('Failed to load family locations');
      return [];
    }
  },

  updateLocationSettings: async (settings) => {
    try {
      const response = await apiService.put('/user/settings/location', settings);
      
      // Update tracking based on new settings
      if (settings.shareLocation !== undefined) {
        if (settings.shareLocation) {
          get().startTracking();
        } else {
          get().stopTracking();
        }
      }

      toast.success('Location settings updated');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Failed to update location settings';
      toast.error(message);
      return { success: false, error: message };
    }
  },

  sendEmergencyAlert: async (message = 'Emergency alert triggered') => {
    try {
      socketService.emit('emergency_alert', { message });
      toast.success('Emergency alert sent to family members');
      return { success: true };
    } catch (error) {
      console.error('Failed to send emergency alert:', error);
      toast.error('Failed to send emergency alert');
      return { success: false };
    }
  },

  clearLocationHistory: async (beforeDate = null) => {
    try {
      const params = beforeDate ? `?before=${beforeDate}` : '';
      const response = await apiService.delete(`/location/history${params}`);
      
      toast.success(`Deleted ${response.data.deletedCount} location records`);
      
      // Refresh location history
      await get().getLocationHistory();
      
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Failed to delete location history';
      toast.error(message);
      return { success: false, error: message };
    }
  },

  getLocationStats: async (startDate, endDate) => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await apiService.get(`/location/stats?${params}`);
      return response.data.stats;
    } catch (error) {
      console.error('Failed to get location stats:', error);
      toast.error('Failed to load location statistics');
      return null;
    }
  },

  findNearbyLocations: async (latitude, longitude, maxDistance = 1000, familyOnly = true) => {
    try {
      const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        maxDistance: maxDistance.toString(),
        familyOnly: familyOnly.toString()
      });

      const response = await apiService.get(`/location/nearby?${params}`);
      return response.data.locations;
    } catch (error) {
      console.error('Failed to find nearby locations:', error);
      toast.error('Failed to find nearby locations');
      return [];
    }
  },

  // Helper functions
  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  },

  formatDistance: (meters) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters / 1000).toFixed(1)}km`;
    }
  },

  getAccuracyLevel: (accuracy) => {
    if (!accuracy) return 'unknown';
    if (accuracy <= 5) return 'high';
    if (accuracy <= 20) return 'medium';
    return 'low';
  },

  getBatteryLevel: (level) => {
    if (!level) return 'unknown';
    if (level > 50) return 'high';
    if (level > 20) return 'medium';
    return 'low';
  },

  // Socket event handlers
  handleMemberLocationUpdate: (data) => {
    set((state) => {
      const updatedFamilyLocations = state.familyLocations.map((location) =>
        location.userId === data.userId ? data : location
      );

      // If this is a new user, add them
      if (!updatedFamilyLocations.find((location) => location.userId === data.userId)) {
        updatedFamilyLocations.push(data);
      }

      return { familyLocations: updatedFamilyLocations };
    });
  },

  handleEmergencyAlert: (data) => {
    toast.error(`Emergency Alert: ${data.userInfo.name} - ${data.message}`, {
      duration: 10000,
      icon: '🚨',
    });
  },

  handleBatteryAlert: (data) => {
    toast.error(
      `Low Battery: ${data.userInfo.name}'s device is at ${data.batteryLevel}%`,
      {
        duration: 6000,
        icon: '🔋',
      }
    );
  },

  handlePlaceAlert: (data) => {
    const message = data.type === 'place_arrival' 
      ? `${data.userInfo.name} arrived at ${data.place.name}`
      : `${data.userInfo.name} left ${data.place.name}`;
    
    toast.success(message, {
      duration: 5000,
      icon: '📍',
    });
  },

  // Cleanup
  cleanup: () => {
    const { watchId } = get();
    
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
    }

    set({
      watchId: null,
      isTrackingEnabled: false,
      currentLocation: null,
      familyLocations: [],
      locationHistory: []
    });
  }
}));
