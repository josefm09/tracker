const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coordinates: {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180
    }
  },
  accuracy: {
    type: Number,
    default: 0 // meters
  },
  altitude: {
    type: Number,
    default: null
  },
  altitudeAccuracy: {
    type: Number,
    default: null
  },
  heading: {
    type: Number,
    default: null // degrees
  },
  speed: {
    type: Number,
    default: null // meters/second
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    formattedAddress: String
  },
  battery: {
    level: {
      type: Number,
      min: 0,
      max: 100
    },
    isCharging: {
      type: Boolean,
      default: false
    }
  },
  deviceInfo: {
    platform: String,
    model: String,
    osVersion: String,
    appVersion: String
  },
  locationMethod: {
    type: String,
    enum: ['gps', 'network', 'passive', 'fused'],
    default: 'gps'
  },
  isManual: {
    type: Boolean,
    default: false
  },
  place: {
    placeId: {
      type: mongoose.Schema.Types.ObjectId
    },
    name: String,
    type: {
      type: String,
      enum: ['home', 'work', 'school', 'other']
    }
  },
  familyIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Family'
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
locationSchema.index({ userId: 1, timestamp: -1 });
locationSchema.index({ 'coordinates.latitude': 1, 'coordinates.longitude': 1 });
locationSchema.index({ timestamp: -1 });
locationSchema.index({ familyIds: 1 });
locationSchema.index({ userId: 1, isActive: 1, timestamp: -1 });

// Geospatial index for location queries
locationSchema.index({ 
  "coordinates": "2dsphere" 
});

// TTL index to automatically delete old location data (after 90 days)
locationSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Static method to get latest location for user
locationSchema.statics.getLatestForUser = function(userId) {
  return this.findOne({ 
    userId, 
    isActive: true 
  }).sort({ timestamp: -1 });
};

// Static method to get latest locations for multiple users
locationSchema.statics.getLatestForUsers = function(userIds) {
  return this.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        isActive: true
      }
    },
    {
      $sort: { userId: 1, timestamp: -1 }
    },
    {
      $group: {
        _id: '$userId',
        location: { $first: '$$ROOT' }
      }
    },
    {
      $replaceRoot: { newRoot: '$location' }
    }
  ]);
};

// Static method to get location history for user
locationSchema.statics.getHistoryForUser = function(userId, startDate, endDate, limit = 100) {
  const query = {
    userId,
    isActive: true,
    timestamp: {
      $gte: startDate,
      $lte: endDate
    }
  };

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit);
};

// Static method to find locations near a point
locationSchema.statics.findNearPoint = function(latitude, longitude, maxDistance = 1000, userId = null) {
  const query = {
    coordinates: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    isActive: true
  };

  if (userId) {
    query.userId = userId;
  }

  return this.find(query);
};

// Method to calculate distance to another location
locationSchema.methods.distanceTo = function(otherLocation) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = this.coordinates.latitude * Math.PI / 180;
  const φ2 = otherLocation.coordinates.latitude * Math.PI / 180;
  const Δφ = (otherLocation.coordinates.latitude - this.coordinates.latitude) * Math.PI / 180;
  const Δλ = (otherLocation.coordinates.longitude - this.coordinates.longitude) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

// Method to check if location is within a place's radius
locationSchema.methods.isWithinPlace = function(place) {
  const distance = this.distanceTo({
    coordinates: {
      latitude: place.coordinates.latitude,
      longitude: place.coordinates.longitude
    }
  });
  
  return distance <= place.radius;
};

// Method to format location for API response
locationSchema.methods.toAPIResponse = function() {
  return {
    id: this._id,
    coordinates: this.coordinates,
    accuracy: this.accuracy,
    timestamp: this.timestamp,
    address: this.address,
    battery: this.battery,
    speed: this.speed,
    heading: this.heading,
    place: this.place
  };
};

// Pre-save middleware to update family IDs
locationSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('userId')) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.userId).select('families');
      if (user && user.families) {
        this.familyIds = user.families.map(family => family.familyId);
      }
    } catch (error) {
      console.error('Error updating family IDs for location:', error);
    }
  }
  next();
});

module.exports = mongoose.model('Location', locationSchema);
