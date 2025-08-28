const Location = require('../models/Location');
const User = require('../models/User');
const Family = require('../models/Family');

module.exports = (io, socket) => {
  const userId = socket.userId;

  // Join user to their personal room
  socket.join(`user_${userId}`);

  // Join user to their family rooms
  joinFamilyRooms(socket, userId);

  // Handle location update
  socket.on('location_update', async (locationData) => {
    try {
      // Validate location data
      if (!locationData.coordinates || 
          !locationData.coordinates.latitude || 
          !locationData.coordinates.longitude) {
        socket.emit('error', { message: 'Invalid location data' });
        return;
      }

      // Create location record
      const locationRecord = new Location({
        userId,
        coordinates: locationData.coordinates,
        accuracy: locationData.accuracy,
        altitude: locationData.altitude,
        altitudeAccuracy: locationData.altitudeAccuracy,
        heading: locationData.heading,
        speed: locationData.speed,
        timestamp: new Date(locationData.timestamp) || new Date(),
        battery: locationData.battery,
        deviceInfo: locationData.deviceInfo,
        locationMethod: locationData.locationMethod || 'gps',
        isManual: locationData.isManual || false
      });

      // Save location
      await locationRecord.save();

      // Get user info for broadcasting
      const user = await User.findById(userId).select('firstName lastName profilePicture families');
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Prepare location update for broadcast
      const locationUpdate = {
        userId,
        userInfo: {
          name: user.fullName,
          profilePicture: user.profilePicture
        },
        location: locationRecord.toAPIResponse(),
        timestamp: new Date()
      };

      // Broadcast to family members
      user.families.forEach(family => {
        socket.to(`family_${family.familyId}`).emit('member_location_update', locationUpdate);
      });

      // Check for place-based alerts
      await checkPlaceAlerts(locationRecord, user);

      // Send confirmation back to sender
      socket.emit('location_update_success', {
        locationId: locationRecord._id,
        timestamp: locationRecord.timestamp
      });

    } catch (error) {
      console.error('Location update error:', error);
      socket.emit('error', { message: 'Failed to update location' });
    }
  });

  // Handle emergency alert
  socket.on('emergency_alert', async (alertData) => {
    try {
      const user = await User.findById(userId).select('firstName lastName phoneNumber families emergencyContact');
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Get latest location
      const latestLocation = await Location.getLatestForUser(userId);
      
      const emergencyAlert = {
        type: 'emergency',
        userId,
        userInfo: {
          name: user.fullName,
          phone: user.phoneNumber
        },
        location: latestLocation ? latestLocation.toAPIResponse() : null,
        message: alertData.message || 'Emergency alert triggered',
        timestamp: new Date(),
        alertId: require('uuid').v4()
      };

      // Broadcast to all family members
      user.families.forEach(family => {
        socket.to(`family_${family.familyId}`).emit('emergency_alert', emergencyAlert);
      });

      // Log emergency alert
      console.log(`Emergency alert from user ${userId}: ${emergencyAlert.message}`);

      socket.emit('emergency_alert_sent', { alertId: emergencyAlert.alertId });

    } catch (error) {
      console.error('Emergency alert error:', error);
      socket.emit('error', { message: 'Failed to send emergency alert' });
    }
  });

  // Handle join family room (when user joins a new family)
  socket.on('join_family', async (familyId) => {
    try {
      const family = await Family.findById(familyId);
      if (!family || !family.isUserMember(userId)) {
        socket.emit('error', { message: 'Not authorized to join this family' });
        return;
      }

      socket.join(`family_${familyId}`);
      socket.emit('joined_family', { familyId });

    } catch (error) {
      console.error('Join family error:', error);
      socket.emit('error', { message: 'Failed to join family room' });
    }
  });

  // Handle leave family room
  socket.on('leave_family', (familyId) => {
    socket.leave(`family_${familyId}`);
    socket.emit('left_family', { familyId });
  });

  // Handle request for family members' locations
  socket.on('get_family_locations', async (familyId) => {
    try {
      const family = await Family.findById(familyId).populate('members.userId', 'firstName lastName profilePicture locationSettings');
      if (!family || !family.isUserMember(userId)) {
        socket.emit('error', { message: 'Not authorized to view this family' });
        return;
      }

      const memberIds = family.members
        .filter(member => member.userId.locationSettings.shareLocation)
        .map(member => member.userId._id);

      const locations = await Location.getLatestForUsers(memberIds);

      const familyLocations = locations.map(location => {
        const member = family.members.find(m => m.userId._id.toString() === location.userId.toString());
        return {
          userId: location.userId,
          userInfo: {
            name: member.userId.fullName,
            profilePicture: member.userId.profilePicture,
            color: member.color
          },
          location: location.toAPIResponse()
        };
      });

      socket.emit('family_locations', {
        familyId,
        locations: familyLocations
      });

    } catch (error) {
      console.error('Get family locations error:', error);
      socket.emit('error', { message: 'Failed to get family locations' });
    }
  });

  // Handle battery alert
  socket.on('battery_alert', async (batteryData) => {
    try {
      if (batteryData.level > 20) return; // Only send alerts for low battery

      const user = await User.findById(userId).select('firstName lastName families');
      if (!user) return;

      const batteryAlert = {
        type: 'battery_low',
        userId,
        userInfo: {
          name: user.fullName
        },
        batteryLevel: batteryData.level,
        isCharging: batteryData.isCharging,
        timestamp: new Date()
      };

      // Broadcast to family members
      user.families.forEach(family => {
        socket.to(`family_${family.familyId}`).emit('battery_alert', batteryAlert);
      });

    } catch (error) {
      console.error('Battery alert error:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    try {
      console.log(`User ${userId} disconnected`);
      
      // Update user's last active time
      await User.findByIdAndUpdate(userId, {
        'deviceInfo.lastActive': new Date()
      });

      // Notify family members that user went offline
      const user = await User.findById(userId).select('families firstName lastName');
      if (user) {
        const offlineNotification = {
          type: 'user_offline',
          userId,
          userInfo: {
            name: user.fullName
          },
          timestamp: new Date()
        };

        user.families.forEach(family => {
          socket.to(`family_${family.familyId}`).emit('user_status_change', offlineNotification);
        });
      }

    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });

  // Notify family members that user came online
  notifyOnlineStatus(socket, userId);
};

// Helper function to join family rooms
async function joinFamilyRooms(socket, userId) {
  try {
    const user = await User.findById(userId).select('families');
    if (user && user.families) {
      user.families.forEach(family => {
        socket.join(`family_${family.familyId}`);
      });
    }
  } catch (error) {
    console.error('Error joining family rooms:', error);
  }
}

// Helper function to notify online status
async function notifyOnlineStatus(socket, userId) {
  try {
    const user = await User.findById(userId).select('families firstName lastName');
    if (user) {
      const onlineNotification = {
        type: 'user_online',
        userId,
        userInfo: {
          name: user.fullName
        },
        timestamp: new Date()
      };

      user.families.forEach(family => {
        socket.to(`family_${family.familyId}`).emit('user_status_change', onlineNotification);
      });
    }
  } catch (error) {
    console.error('Error notifying online status:', error);
  }
}

// Helper function to check place-based alerts
async function checkPlaceAlerts(locationRecord, user) {
  try {
    // Get all families the user belongs to
    const families = await Family.find({
      'members.userId': user._id
    });

    for (const family of families) {
      for (const place of family.places) {
        if (locationRecord.isWithinPlace(place)) {
          // User is at this place, send arrival alert if enabled
          if (place.notifications.arrivalAlerts) {
            const arrivalAlert = {
              type: 'place_arrival',
              userId: user._id,
              userInfo: {
                name: user.fullName
              },
              place: {
                name: place.name,
                type: place.type
              },
              timestamp: new Date()
            };

            // Emit to family members who should be notified
            const membersToNotify = place.notifications.membersToNotify.length > 0 
              ? place.notifications.membersToNotify 
              : family.members.map(m => m.userId);

            membersToNotify.forEach(memberId => {
              if (memberId.toString() !== user._id.toString()) {
                require('../server').io.to(`user_${memberId}`).emit('place_alert', arrivalAlert);
              }
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking place alerts:', error);
  }
}
