const mongoose = require('mongoose');

const familySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 200
  },
  inviteCode: {
    type: String,
    unique: true,
    required: true
  },
  members: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    nickname: {
      type: String,
      trim: true
    },
    color: {
      type: String,
      default: '#007AFF'
    },
    notifications: {
      locationAlerts: {
        type: Boolean,
        default: true
      },
      emergencyAlerts: {
        type: Boolean,
        default: true
      },
      batteryAlerts: {
        type: Boolean,
        default: true
      }
    }
  }],
  settings: {
    allowNewMembers: {
      type: Boolean,
      default: true
    },
    requireApprovalForNewMembers: {
      type: Boolean,
      default: false
    },
    locationHistoryDays: {
      type: Number,
      default: 30
    },
    emergencyContactsVisible: {
      type: Boolean,
      default: true
    }
  },
  places: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    address: String,
    coordinates: {
      latitude: {
        type: Number,
        required: true
      },
      longitude: {
        type: Number,
        required: true
      }
    },
    radius: {
      type: Number,
      default: 100 // meters
    },
    type: {
      type: String,
      enum: ['home', 'work', 'school', 'other'],
      default: 'other'
    },
    notifications: {
      arrivalAlerts: {
        type: Boolean,
        default: true
      },
      departureAlerts: {
        type: Boolean,
        default: true
      },
      membersToNotify: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }]
    },
    icon: {
      type: String,
      default: 'location'
    },
    color: {
      type: String,
      default: '#007AFF'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  emergencyContacts: [{
    name: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },
    relationship: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for member count
familySchema.virtual('memberCount').get(function() {
  return this.members ? this.members.length : 0;
});

// Virtual for admin count
familySchema.virtual('adminCount').get(function() {
  return this.members ? this.members.filter(member => member.role === 'admin').length : 0;
});

// Indexes for better performance
familySchema.index({ inviteCode: 1 });
familySchema.index({ 'members.userId': 1 });
familySchema.index({ createdBy: 1 });
familySchema.index({ isActive: 1 });

// Generate unique invite code
familySchema.statics.generateInviteCode = function() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

// Add member to family
familySchema.methods.addMember = function(userId, role = 'member', nickname = null) {
  // Check if user is already a member
  const existingMember = this.members.find(member => member.userId.toString() === userId.toString());
  if (existingMember) {
    throw new Error('User is already a member of this family');
  }

  const colors = ['#007AFF', '#FF3B30', '#00C957', '#FF9500', '#AF52DE', '#FF2D92', '#5AC8FA', '#FFCC00'];
  const memberColor = colors[this.members.length % colors.length];

  this.members.push({
    userId,
    role,
    nickname,
    color: memberColor,
    joinedAt: new Date()
  });

  return this.save();
};

// Remove member from family
familySchema.methods.removeMember = function(userId) {
  this.members = this.members.filter(member => member.userId.toString() !== userId.toString());
  return this.save();
};

// Update member role
familySchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(member => member.userId.toString() === userId.toString());
  if (!member) {
    throw new Error('User is not a member of this family');
  }
  
  member.role = newRole;
  return this.save();
};

// Check if user is admin
familySchema.methods.isUserAdmin = function(userId) {
  const member = this.members.find(member => member.userId.toString() === userId.toString());
  return member && member.role === 'admin';
};

// Check if user is member
familySchema.methods.isUserMember = function(userId) {
  return this.members.some(member => member.userId.toString() === userId.toString());
};

// Add place to family
familySchema.methods.addPlace = function(placeData, createdBy) {
  placeData.createdBy = createdBy;
  placeData.createdAt = new Date();
  this.places.push(placeData);
  return this.save();
};

// Remove place from family
familySchema.methods.removePlace = function(placeId) {
  this.places = this.places.filter(place => place._id.toString() !== placeId.toString());
  return this.save();
};

module.exports = mongoose.model('Family', familySchema);
