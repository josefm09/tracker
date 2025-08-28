const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  profilePicture: {
    type: String,
    default: null
  },
  dateOfBirth: {
    type: Date
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  families: [{
    familyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Family'
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  locationSettings: {
    shareLocation: {
      type: Boolean,
      default: true
    },
    locationAccuracy: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    updateFrequency: {
      type: Number,
      default: 30000 // milliseconds
    }
  },
  privacySettings: {
    shareLocationHistory: {
      type: Boolean,
      default: true
    },
    allowEmergencyAlerts: {
      type: Boolean,
      default: true
    },
    visibleToFamily: {
      type: Boolean,
      default: true
    }
  },
  deviceInfo: {
    deviceId: String,
    platform: String,
    appVersion: String,
    lastActive: {
      type: Date,
      default: Date.now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Index for better performance
userSchema.index({ email: 1 });
userSchema.index({ 'families.familyId': 1 });
userSchema.index({ 'deviceInfo.lastActive': 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update last active
userSchema.methods.updateLastActive = function() {
  this.deviceInfo.lastActive = new Date();
  this.lastLogin = new Date();
  return this.save();
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);
