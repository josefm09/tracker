const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Token expired' });
    }
    
    console.error('Authentication error:', error);
    return res.status(500).json({ message: 'Server error during authentication' });
  }
};

// Middleware to authenticate Socket.IO connections
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return next(new Error('Invalid or expired token'));
    }

    // Update user's last active time
    await user.updateLastActive();

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new Error('Invalid or expired token'));
    }
    
    console.error('Socket authentication error:', error);
    return next(new Error('Authentication failed'));
  }
};

// Middleware to check if user is admin of a family
const requireFamilyAdmin = async (req, res, next) => {
  try {
    const { familyId } = req.params;
    const userId = req.userId;

    const Family = require('../models/Family');
    const family = await Family.findById(familyId);

    if (!family) {
      return res.status(404).json({ message: 'Family not found' });
    }

    if (!family.isUserAdmin(userId)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    req.family = family;
    next();
  } catch (error) {
    console.error('Family admin check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user is member of a family
const requireFamilyMember = async (req, res, next) => {
  try {
    const { familyId } = req.params;
    const userId = req.userId;

    const Family = require('../models/Family');
    const family = await Family.findById(familyId);

    if (!family) {
      return res.status(404).json({ message: 'Family not found' });
    }

    if (!family.isUserMember(userId)) {
      return res.status(403).json({ message: 'Family membership required' });
    }

    req.family = family;
    next();
  } catch (error) {
    console.error('Family member check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
};

// Generate refresh token (longer expiration)
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' } // Refresh token expires in 30 days
  );
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw error;
  }
};

module.exports = {
  authenticateToken,
  authenticateSocket,
  requireFamilyAdmin,
  requireFamilyMember,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken
};
