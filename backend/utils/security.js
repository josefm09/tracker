const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Security utilities for the GPS tracker application

/**
 * Generate a cryptographically secure random string
 * @param {number} length - Length of the string to generate
 * @returns {string} Random string
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Hash sensitive data using SHA-256
 * @param {string} data - Data to hash
 * @param {string} salt - Salt to use for hashing
 * @returns {string} Hashed data
 */
const hashData = (data, salt = '') => {
  return crypto.createHash('sha256').update(data + salt).digest('hex');
};

/**
 * Sanitize location data to prevent injection attacks
 * @param {object} locationData - Location data to sanitize
 * @returns {object} Sanitized location data
 */
const sanitizeLocationData = (locationData) => {
  const sanitized = {};
  
  // Validate and sanitize coordinates
  if (locationData.coordinates) {
    const { latitude, longitude } = locationData.coordinates;
    
    if (typeof latitude === 'number' && latitude >= -90 && latitude <= 90) {
      sanitized.coordinates = sanitized.coordinates || {};
      sanitized.coordinates.latitude = parseFloat(latitude.toFixed(8));
    }
    
    if (typeof longitude === 'number' && longitude >= -180 && longitude <= 180) {
      sanitized.coordinates = sanitized.coordinates || {};
      sanitized.coordinates.longitude = parseFloat(longitude.toFixed(8));
    }
  }
  
  // Sanitize numeric values
  ['accuracy', 'altitude', 'altitudeAccuracy', 'heading', 'speed'].forEach(field => {
    if (typeof locationData[field] === 'number' && !isNaN(locationData[field])) {
      sanitized[field] = parseFloat(locationData[field].toFixed(2));
    }
  });
  
  // Sanitize timestamp
  if (locationData.timestamp) {
    const timestamp = new Date(locationData.timestamp);
    if (!isNaN(timestamp.getTime())) {
      sanitized.timestamp = timestamp;
    }
  }
  
  // Sanitize battery data
  if (locationData.battery) {
    const battery = {};
    if (typeof locationData.battery.level === 'number' && 
        locationData.battery.level >= 0 && locationData.battery.level <= 100) {
      battery.level = Math.round(locationData.battery.level);
    }
    if (typeof locationData.battery.isCharging === 'boolean') {
      battery.isCharging = locationData.battery.isCharging;
    }
    if (Object.keys(battery).length > 0) {
      sanitized.battery = battery;
    }
  }
  
  // Sanitize device info
  if (locationData.deviceInfo) {
    const deviceInfo = {};
    ['platform', 'model', 'osVersion', 'appVersion'].forEach(field => {
      if (typeof locationData.deviceInfo[field] === 'string') {
        deviceInfo[field] = locationData.deviceInfo[field].trim().substring(0, 50);
      }
    });
    if (Object.keys(deviceInfo).length > 0) {
      sanitized.deviceInfo = deviceInfo;
    }
  }
  
  return sanitized;
};

/**
 * Sanitize user input to prevent XSS and injection attacks
 * @param {string} input - Input string to sanitize
 * @param {number} maxLength - Maximum length allowed
 * @returns {string} Sanitized string
 */
const sanitizeInput = (input, maxLength = 255) => {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[<>\"'&]/g, (char) => {
      const entityMap = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '&': '&amp;'
      };
      return entityMap[char];
    })
    .substring(0, maxLength);
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number format (basic validation)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if phone number is valid
 */
const isValidPhone = (phone) => {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
};

/**
 * Check if password meets security requirements
 * @param {string} password - Password to validate
 * @returns {object} Validation result with success and errors
 */
const validatePassword = (password) => {
  const errors = [];
  
  if (password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Rate limiting configurations for different endpoints
 */
const rateLimitConfigs = {
  // Strict rate limiting for authentication endpoints
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: {
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.ip + ':' + (req.body?.email || 'unknown');
    }
  }),
  
  // Moderate rate limiting for location updates
  location: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 updates per minute
    message: {
      message: 'Too many location updates, please slow down.',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.userId || req.ip;
    }
  }),
  
  // General API rate limiting
  api: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: {
      message: 'Too many API requests, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
  })
};

/**
 * Privacy settings validator
 * @param {object} settings - Privacy settings to validate
 * @returns {object} Validation result
 */
const validatePrivacySettings = (settings) => {
  const validSettings = {};
  const errors = [];
  
  // Validate boolean settings
  const booleanFields = [
    'shareLocation',
    'shareLocationHistory',
    'allowEmergencyAlerts',
    'visibleToFamily'
  ];
  
  booleanFields.forEach(field => {
    if (field in settings) {
      if (typeof settings[field] === 'boolean') {
        validSettings[field] = settings[field];
      } else {
        errors.push(`${field} must be a boolean value`);
      }
    }
  });
  
  // Validate location accuracy setting
  if ('locationAccuracy' in settings) {
    const validAccuracies = ['high', 'medium', 'low'];
    if (validAccuracies.includes(settings.locationAccuracy)) {
      validSettings.locationAccuracy = settings.locationAccuracy;
    } else {
      errors.push('locationAccuracy must be high, medium, or low');
    }
  }
  
  // Validate update frequency
  if ('updateFrequency' in settings) {
    const frequency = parseInt(settings.updateFrequency);
    if (frequency >= 5000 && frequency <= 300000) {
      validSettings.updateFrequency = frequency;
    } else {
      errors.push('updateFrequency must be between 5000 and 300000 milliseconds');
    }
  }
  
  return {
    isValid: errors.length === 0,
    validSettings,
    errors
  };
};

/**
 * Geofence validation to ensure location is within expected bounds
 * @param {number} latitude - Latitude to validate
 * @param {number} longitude - Longitude to validate
 * @param {object} bounds - Optional bounds to validate against
 * @returns {boolean} True if location is valid
 */
const isLocationWithinBounds = (latitude, longitude, bounds = null) => {
  // Basic validation
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }
  
  // Custom bounds validation (if provided)
  if (bounds) {
    const { north, south, east, west } = bounds;
    if (latitude > north || latitude < south || 
        longitude > east || longitude < west) {
      return false;
    }
  }
  
  return true;
};

/**
 * Check if user has permission to access another user's data
 * @param {object} requester - User requesting access
 * @param {object} target - Target user
 * @param {string} dataType - Type of data being accessed
 * @returns {boolean} True if access is allowed
 */
const hasDataAccessPermission = (requester, target, dataType = 'location') => {
  // Users can always access their own data
  if (requester._id.toString() === target._id.toString()) {
    return true;
  }
  
  // Check if users are in the same family
  const sharedFamily = requester.families.some(requesterFamily =>
    target.families.some(targetFamily =>
      targetFamily.familyId.toString() === requesterFamily.familyId.toString()
    )
  );
  
  if (!sharedFamily) {
    return false;
  }
  
  // Check specific permissions based on data type
  switch (dataType) {
    case 'location':
      return target.locationSettings?.shareLocation && 
             target.privacySettings?.visibleToFamily;
    
    case 'locationHistory':
      return target.privacySettings?.shareLocationHistory && 
             target.privacySettings?.visibleToFamily;
    
    case 'profile':
      return target.privacySettings?.visibleToFamily;
    
    default:
      return false;
  }
};

/**
 * Log security events
 * @param {string} event - Event type
 * @param {object} details - Event details
 * @param {string} userId - User ID (if applicable)
 * @param {string} ip - IP address
 */
const logSecurityEvent = (event, details, userId = null, ip = null) => {
  const logEntry = {
    timestamp: new Date(),
    event,
    details,
    userId,
    ip,
    severity: getSeverityLevel(event)
  };
  
  // In production, this should log to a proper security monitoring system
  console.log('SECURITY EVENT:', JSON.stringify(logEntry));
  
  // For critical events, you might want to send alerts
  if (logEntry.severity === 'critical') {
    // Send alert to security team
    console.error('CRITICAL SECURITY EVENT:', logEntry);
  }
};

/**
 * Get severity level for security events
 * @param {string} event - Event type
 * @returns {string} Severity level
 */
const getSeverityLevel = (event) => {
  const criticalEvents = ['multiple_failed_logins', 'account_locked', 'data_breach_attempt'];
  const warningEvents = ['failed_login', 'invalid_token', 'rate_limit_exceeded'];
  
  if (criticalEvents.includes(event)) {
    return 'critical';
  } else if (warningEvents.includes(event)) {
    return 'warning';
  } else {
    return 'info';
  }
};

module.exports = {
  generateSecureToken,
  hashData,
  sanitizeLocationData,
  sanitizeInput,
  isValidEmail,
  isValidPhone,
  validatePassword,
  rateLimitConfigs,
  validatePrivacySettings,
  isLocationWithinBounds,
  hasDataAccessPermission,
  logSecurityEvent
};
