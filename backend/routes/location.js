const express = require('express');
const { body, query, validationResult } = require('express-validator');

const Location = require('../models/Location');
const User = require('../models/User');
const Family = require('../models/Family');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All location routes require authentication
router.use(authenticateToken);

// POST /api/location/update - Update user's location
router.post('/update', [
  body('coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number'),
  body('timestamp')
    .optional()
    .isISO8601()
    .withMessage('Timestamp must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const locationData = req.body;

    // Check if user allows location sharing
    const user = await User.findById(userId).select('locationSettings families');
    if (!user.locationSettings.shareLocation) {
      return res.status(403).json({
        message: 'Location sharing is disabled for this user'
      });
    }

    // Create location record
    const location = new Location({
      userId,
      coordinates: locationData.coordinates,
      accuracy: locationData.accuracy || 0,
      altitude: locationData.altitude,
      altitudeAccuracy: locationData.altitudeAccuracy,
      heading: locationData.heading,
      speed: locationData.speed,
      timestamp: locationData.timestamp ? new Date(locationData.timestamp) : new Date(),
      address: locationData.address,
      battery: locationData.battery,
      deviceInfo: locationData.deviceInfo,
      locationMethod: locationData.locationMethod || 'gps',
      isManual: locationData.isManual || false
    });

    // Check if location is within any family places
    const families = await Family.find({
      'members.userId': userId,
      isActive: true
    });

    for (const family of families) {
      for (const place of family.places) {
        if (location.isWithinPlace(place)) {
          location.place = {
            placeId: place._id,
            name: place.name,
            type: place.type
          };
          break;
        }
      }
    }

    await location.save();

    res.json({
      message: 'Location updated successfully',
      location: location.toAPIResponse()
    });

  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/location/current - Get current user's location
router.get('/current', async (req, res) => {
  try {
    const userId = req.userId;
    
    const location = await Location.getLatestForUser(userId);
    
    if (!location) {
      return res.status(404).json({ message: 'No location found' });
    }

    res.json({
      location: location.toAPIResponse()
    });

  } catch (error) {
    console.error('Get current location error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/location/history - Get location history for current user
router.get('/history', [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Limit must be between 1 and 1000')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { startDate, endDate, limit = 100 } = req.query;

    // Default to last 7 days if no date range provided
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const locations = await Location.getHistoryForUser(userId, start, end, parseInt(limit));

    const locationHistory = locations.map(location => location.toAPIResponse());

    res.json({
      locations: locationHistory,
      count: locationHistory.length,
      dateRange: {
        start,
        end
      }
    });

  } catch (error) {
    console.error('Get location history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/location/user/:userId/history - Get location history for specific user (family members only)
router.get('/user/:userId/history', [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Limit must be between 1 and 1000')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const requesterId = req.userId;
    const targetUserId = req.params.userId;
    const { startDate, endDate, limit = 100 } = req.query;

    // Check if requester and target user are in the same family
    const requesterUser = await User.findById(requesterId).select('families');
    const targetUser = await User.findById(targetUserId).select('families locationSettings privacySettings');

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if target user allows location history sharing
    if (!targetUser.privacySettings.shareLocationHistory) {
      return res.status(403).json({ message: 'User has disabled location history sharing' });
    }

    // Check if users share any family
    const sharedFamily = requesterUser.families.some(requesterFamily =>
      targetUser.families.some(targetFamily =>
        targetFamily.familyId.toString() === requesterFamily.familyId.toString()
      )
    );

    if (!sharedFamily) {
      return res.status(403).json({ message: 'Not authorized to view this user\'s location history' });
    }

    // Default to last 7 days if no date range provided
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const locations = await Location.getHistoryForUser(targetUserId, start, end, parseInt(limit));

    const locationHistory = locations.map(location => location.toAPIResponse());

    res.json({
      userId: targetUserId,
      locations: locationHistory,
      count: locationHistory.length,
      dateRange: {
        start,
        end
      }
    });

  } catch (error) {
    console.error('Get user location history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/location/nearby - Find locations near a point
router.get('/nearby', [
  query('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  query('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  query('maxDistance')
    .optional()
    .isInt({ min: 1, max: 50000 })
    .withMessage('Max distance must be between 1 and 50000 meters'),
  query('familyOnly')
    .optional()
    .isBoolean()
    .withMessage('FamilyOnly must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { latitude, longitude, maxDistance = 1000, familyOnly = true } = req.query;

    let locations;

    if (familyOnly === 'true') {
      // Get user's families
      const user = await User.findById(userId).select('families');
      const familyIds = user.families.map(f => f.familyId);

      // Find nearby locations from family members only
      locations = await Location.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [parseFloat(longitude), parseFloat(latitude)]
            },
            distanceField: "distance",
            maxDistance: parseInt(maxDistance),
            spherical: true,
            query: {
              familyIds: { $in: familyIds },
              isActive: true,
              userId: { $ne: userId } // Exclude current user
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $match: {
            'user.locationSettings.shareLocation': true,
            'user.privacySettings.visibleToFamily': true
          }
        },
        {
          $project: {
            coordinates: 1,
            timestamp: 1,
            address: 1,
            place: 1,
            distance: 1,
            'user.firstName': 1,
            'user.lastName': 1,
            'user.profilePicture': 1
          }
        },
        {
          $limit: 50
        }
      ]);
    } else {
      // Find all nearby locations (this might be limited based on privacy settings)
      locations = await Location.findNearPoint(
        parseFloat(latitude),
        parseFloat(longitude),
        parseInt(maxDistance)
      ).limit(50);
    }

    res.json({
      locations: locations.map(location => ({
        ...location.toAPIResponse ? location.toAPIResponse() : location,
        userInfo: location.user ? {
          name: `${location.user.firstName} ${location.user.lastName}`,
          profilePicture: location.user.profilePicture
        } : null,
        distance: location.distance
      })),
      searchPoint: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      },
      maxDistance: parseInt(maxDistance)
    });

  } catch (error) {
    console.error('Find nearby locations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/location/history - Delete location history (privacy feature)
router.delete('/history', [
  query('before')
    .optional()
    .isISO8601()
    .withMessage('Before date must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { before } = req.query;

    const deleteQuery = {
      userId,
      isActive: true
    };

    if (before) {
      deleteQuery.timestamp = { $lt: new Date(before) };
    }

    // Mark locations as inactive instead of deleting (for data integrity)
    const result = await Location.updateMany(
      deleteQuery,
      { $set: { isActive: false } }
    );

    res.json({
      message: 'Location history deleted successfully',
      deletedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Delete location history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/location/stats - Get location statistics
router.get('/stats', [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { startDate, endDate } = req.query;

    // Default to last 30 days if no date range provided
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const stats = await Location.aggregate([
      {
        $match: {
          userId: userId,
          isActive: true,
          timestamp: {
            $gte: start,
            $lte: end
          }
        }
      },
      {
        $group: {
          _id: null,
          totalLocations: { $sum: 1 },
          averageAccuracy: { $avg: '$accuracy' },
          maxSpeed: { $max: '$speed' },
          averageSpeed: { $avg: { $ifNull: ['$speed', 0] } },
          locationMethods: {
            $push: '$locationMethod'
          },
          places: {
            $push: '$place.name'
          },
          firstLocation: { $min: '$timestamp' },
          lastLocation: { $max: '$timestamp' }
        }
      },
      {
        $project: {
          _id: 0,
          totalLocations: 1,
          averageAccuracy: { $round: ['$averageAccuracy', 2] },
          maxSpeed: { $round: [{ $ifNull: ['$maxSpeed', 0] }, 2] },
          averageSpeed: { $round: ['$averageSpeed', 2] },
          locationMethodCounts: {
            $arrayToObject: {
              $map: {
                input: { $setUnion: ['$locationMethods', []] },
                as: 'method',
                in: {
                  k: '$$method',
                  v: {
                    $size: {
                      $filter: {
                        input: '$locationMethods',
                        cond: { $eq: ['$$this', '$$method'] }
                      }
                    }
                  }
                }
              }
            }
          },
          uniquePlaces: {
            $size: {
              $setUnion: [
                {
                  $filter: {
                    input: '$places',
                    cond: { $ne: ['$$this', null] }
                  }
                },
                []
              ]
            }
          },
          firstLocation: 1,
          lastLocation: 1
        }
      }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalLocations: 0,
      averageAccuracy: 0,
      maxSpeed: 0,
      averageSpeed: 0,
      locationMethodCounts: {},
      uniquePlaces: 0,
      firstLocation: null,
      lastLocation: null
    };

    res.json({
      stats: result,
      dateRange: {
        start,
        end
      }
    });

  } catch (error) {
    console.error('Get location stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
