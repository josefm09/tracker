const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const User = require('../models/User');
const { generateToken, generateRefreshToken, verifyRefreshToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation rules
const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name is required and must be less than 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name is required and must be less than 50 characters'),
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// POST /api/auth/register
router.post('/register', authLimiter, registerValidation, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password, firstName, lastName, phoneNumber, dateOfBirth } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const user = new User({
      email,
      password, // Will be hashed by the pre-save middleware
      firstName,
      lastName,
      phoneNumber,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined
    });

    await user.save();

    // Generate tokens
    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Remove password from response
    const userResponse = user.toJSON();

    res.status(201).json({
      message: 'User registered successfully',
      user: userResponse,
      accessToken,
      refreshToken
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, loginValidation, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password, deviceInfo } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Update device info if provided
    if (deviceInfo) {
      user.deviceInfo = {
        ...user.deviceInfo,
        ...deviceInfo,
        lastActive: new Date()
      };
      await user.save();
    } else {
      await user.updateLastActive();
    }

    // Generate tokens
    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Remove password from response
    const userResponse = user.toJSON();

    res.json({
      message: 'Login successful',
      user: userResponse,
      accessToken,
      refreshToken
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    // Get user to ensure they still exist and are active
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        message: 'Invalid refresh token'
      });
    }

    // Generate new access token
    const accessToken = generateToken(user._id);
    
    res.json({
      accessToken,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      message: 'Invalid or expired refresh token'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update user's last active time
    await req.user.updateLastActive();

    res.json({
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      message: 'Server error during logout'
    });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    // Return current user data
    res.json({
      user: req.user.toJSON()
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      message: 'Server error'
    });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticateToken, [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number')
], async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword; // Will be hashed by pre-save middleware
    await user.save();

    res.json({
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      message: 'Server error during password change'
    });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    // In a real application, you would send an email with a verification code
    // For now, we'll just mark the email as verified
    user.emailVerified = true;
    await user.save();

    res.json({
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      message: 'Server error during email verification'
    });
  }
});

module.exports = router;
