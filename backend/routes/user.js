const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');

const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(authenticateToken);

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// GET /api/user/profile - Get user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('families.familyId', 'name inviteCode memberCount')
      .select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: user.toJSON() });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/user/profile - Update user profile
router.put('/profile', [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters'),
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Date of birth must be a valid date'),
  body('emergencyContact.name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Emergency contact name must be between 1 and 100 characters'),
  body('emergencyContact.phone')
    .optional()
    .isMobilePhone()
    .withMessage('Emergency contact phone must be a valid phone number'),
  body('emergencyContact.relationship')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Emergency contact relationship must be between 1 and 50 characters')
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
    const updateData = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user fields
    if (updateData.firstName) user.firstName = updateData.firstName;
    if (updateData.lastName) user.lastName = updateData.lastName;
    if (updateData.phoneNumber !== undefined) user.phoneNumber = updateData.phoneNumber;
    if (updateData.dateOfBirth) user.dateOfBirth = new Date(updateData.dateOfBirth);
    if (updateData.emergencyContact) {
      user.emergencyContact = {
        ...user.emergencyContact,
        ...updateData.emergencyContact
      };
    }

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/user/profile/picture - Upload profile picture
router.post('/profile/picture', upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // In a real application, you would upload the file to a cloud storage service
    // For now, we'll store the file as base64 (not recommended for production)
    const base64Image = req.file.buffer.toString('base64');
    const imageDataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    user.profilePicture = imageDataUrl;
    await user.save();

    res.json({
      message: 'Profile picture updated successfully',
      profilePicture: user.profilePicture
    });

  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/user/settings/location - Update location settings
router.put('/settings/location', [
  body('shareLocation')
    .optional()
    .isBoolean()
    .withMessage('Share location must be a boolean'),
  body('locationAccuracy')
    .optional()
    .isIn(['high', 'medium', 'low'])
    .withMessage('Location accuracy must be high, medium, or low'),
  body('updateFrequency')
    .optional()
    .isInt({ min: 5000, max: 300000 })
    .withMessage('Update frequency must be between 5000 and 300000 milliseconds')
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
    const { shareLocation, locationAccuracy, updateFrequency } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update location settings
    if (shareLocation !== undefined) user.locationSettings.shareLocation = shareLocation;
    if (locationAccuracy) user.locationSettings.locationAccuracy = locationAccuracy;
    if (updateFrequency) user.locationSettings.updateFrequency = updateFrequency;

    await user.save();

    res.json({
      message: 'Location settings updated successfully',
      locationSettings: user.locationSettings
    });

  } catch (error) {
    console.error('Update location settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/user/settings/privacy - Update privacy settings
router.put('/settings/privacy', [
  body('shareLocationHistory')
    .optional()
    .isBoolean()
    .withMessage('Share location history must be a boolean'),
  body('allowEmergencyAlerts')
    .optional()
    .isBoolean()
    .withMessage('Allow emergency alerts must be a boolean'),
  body('visibleToFamily')
    .optional()
    .isBoolean()
    .withMessage('Visible to family must be a boolean')
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
    const { shareLocationHistory, allowEmergencyAlerts, visibleToFamily } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update privacy settings
    if (shareLocationHistory !== undefined) user.privacySettings.shareLocationHistory = shareLocationHistory;
    if (allowEmergencyAlerts !== undefined) user.privacySettings.allowEmergencyAlerts = allowEmergencyAlerts;
    if (visibleToFamily !== undefined) user.privacySettings.visibleToFamily = visibleToFamily;

    await user.save();

    res.json({
      message: 'Privacy settings updated successfully',
      privacySettings: user.privacySettings
    });

  } catch (error) {
    console.error('Update privacy settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/user/device-info - Get device information
router.get('/device-info', async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('deviceInfo');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ deviceInfo: user.deviceInfo });

  } catch (error) {
    console.error('Get device info error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/user/device-info - Update device information
router.put('/device-info', [
  body('deviceId')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Device ID must be between 1 and 100 characters'),
  body('platform')
    .optional()
    .trim()
    .isIn(['ios', 'android', 'web'])
    .withMessage('Platform must be ios, android, or web'),
  body('appVersion')
    .optional()
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('App version must be between 1 and 20 characters')
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
    const { deviceId, platform, appVersion } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update device information
    if (deviceId) user.deviceInfo.deviceId = deviceId;
    if (platform) user.deviceInfo.platform = platform;
    if (appVersion) user.deviceInfo.appVersion = appVersion;
    user.deviceInfo.lastActive = new Date();

    await user.save();

    res.json({
      message: 'Device information updated successfully',
      deviceInfo: user.deviceInfo
    });

  } catch (error) {
    console.error('Update device info error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/user/activity - Get user activity summary
router.get('/activity', async (req, res) => {
  try {
    const userId = req.userId;

    // Get user with families and recent location data
    const user = await User.findById(userId)
      .populate('families.familyId', 'name memberCount')
      .select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get location statistics for the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const Location = require('../models/Location');
    const locationStats = await Location.aggregate([
      {
        $match: {
          userId: userId,
          isActive: true,
          timestamp: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalLocations: { $sum: 1 },
          averageAccuracy: { $avg: '$accuracy' },
          uniqueDays: {
            $addToSet: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$timestamp'
              }
            }
          }
        }
      }
    ]);

    const stats = locationStats[0] || {
      totalLocations: 0,
      averageAccuracy: 0,
      uniqueDays: []
    };

    const activitySummary = {
      user: user.toJSON(),
      stats: {
        totalLocations: stats.totalLocations,
        averageAccuracy: Math.round(stats.averageAccuracy || 0),
        activeDays: stats.uniqueDays.length,
        familyCount: user.families.length,
        lastActive: user.deviceInfo.lastActive
      }
    };

    res.json(activitySummary);

  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/user/account - Delete user account
router.delete('/account', [
  body('password')
    .notEmpty()
    .withMessage('Password is required to delete account')
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
    const { password } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    // Remove user from all families
    const Family = require('../models/Family');
    for (const familyRef of user.families) {
      const family = await Family.findById(familyRef.familyId);
      if (family) {
        await family.removeMember(userId);
        
        // If this was the last member, mark family as inactive
        if (family.members.length === 0) {
          family.isActive = false;
          await family.save();
        }
      }
    }

    // Mark user as inactive instead of deleting (for data integrity)
    user.isActive = false;
    user.email = `deleted_${userId}@deleted.com`;
    await user.save();

    // Mark user's locations as inactive
    const Location = require('../models/Location');
    await Location.updateMany(
      { userId },
      { $set: { isActive: false } }
    );

    res.json({ message: 'Account deleted successfully' });

  } catch (error) {
    console.error('Delete user account error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
