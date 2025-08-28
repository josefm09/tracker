const express = require('express');
const { body, validationResult } = require('express-validator');

const Family = require('../models/Family');
const User = require('../models/User');
const Location = require('../models/Location');
const { authenticateToken, requireFamilyAdmin, requireFamilyMember } = require('../middleware/auth');

const router = express.Router();

// All family routes require authentication
router.use(authenticateToken);

// GET /api/family - Get all families the user belongs to
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate({
      path: 'families.familyId',
      populate: {
        path: 'members.userId',
        select: 'firstName lastName profilePicture deviceInfo'
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const families = user.families.map(familyRef => ({
      ...familyRef.familyId.toJSON(),
      userRole: familyRef.role,
      joinedAt: familyRef.joinedAt
    }));

    res.json({ families });

  } catch (error) {
    console.error('Get families error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/family - Create a new family
router.post('/', [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Family name is required and must be less than 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description must be less than 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, description } = req.body;
    const userId = req.userId;

    // Generate unique invite code
    let inviteCode;
    let codeExists = true;
    
    while (codeExists) {
      inviteCode = Family.generateInviteCode();
      const existingFamily = await Family.findOne({ inviteCode });
      codeExists = !!existingFamily;
    }

    // Create new family
    const family = new Family({
      name,
      description,
      inviteCode,
      createdBy: userId,
      members: [{
        userId,
        role: 'admin',
        joinedAt: new Date()
      }]
    });

    await family.save();

    // Add family to user's families array
    const user = await User.findById(userId);
    user.families.push({
      familyId: family._id,
      role: 'admin',
      joinedAt: new Date()
    });
    await user.save();

    // Populate the family data for response
    await family.populate('members.userId', 'firstName lastName profilePicture');

    res.status(201).json({
      message: 'Family created successfully',
      family: family.toJSON()
    });

  } catch (error) {
    console.error('Create family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/family/join - Join a family using invite code
router.post('/join', [
  body('inviteCode')
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage('Invite code must be 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { inviteCode } = req.body;
    const userId = req.userId;

    // Find family by invite code
    const family = await Family.findOne({ inviteCode, isActive: true });
    if (!family) {
      return res.status(404).json({ message: 'Invalid invite code' });
    }

    // Check if family allows new members
    if (!family.settings.allowNewMembers) {
      return res.status(403).json({ message: 'This family is not accepting new members' });
    }

    // Check if user is already a member
    if (family.isUserMember(userId)) {
      return res.status(409).json({ message: 'You are already a member of this family' });
    }

    // Add member to family
    await family.addMember(userId);

    // Add family to user's families array
    const user = await User.findById(userId);
    user.families.push({
      familyId: family._id,
      role: 'member',
      joinedAt: new Date()
    });
    await user.save();

    // Populate the family data for response
    await family.populate('members.userId', 'firstName lastName profilePicture');

    res.json({
      message: 'Successfully joined family',
      family: family.toJSON()
    });

  } catch (error) {
    console.error('Join family error:', error);
    if (error.message.includes('already a member')) {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/family/:familyId - Get family details
router.get('/:familyId', requireFamilyMember, async (req, res) => {
  try {
    const family = await Family.findById(req.params.familyId)
      .populate('members.userId', 'firstName lastName profilePicture deviceInfo locationSettings')
      .populate('createdBy', 'firstName lastName');

    res.json({ family: family.toJSON() });

  } catch (error) {
    console.error('Get family details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/family/:familyId - Update family details (admin only)
router.put('/:familyId', requireFamilyAdmin, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Family name must be between 1 and 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description must be less than 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, description, settings } = req.body;
    const family = req.family;

    if (name) family.name = name;
    if (description !== undefined) family.description = description;
    if (settings) family.settings = { ...family.settings, ...settings };

    await family.save();
    await family.populate('members.userId', 'firstName lastName profilePicture');

    res.json({
      message: 'Family updated successfully',
      family: family.toJSON()
    });

  } catch (error) {
    console.error('Update family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/family/:familyId - Delete family (admin only)
router.delete('/:familyId', requireFamilyAdmin, async (req, res) => {
  try {
    const family = req.family;

    // Remove family from all members' user records
    const memberIds = family.members.map(member => member.userId);
    await User.updateMany(
      { _id: { $in: memberIds } },
      { $pull: { families: { familyId: family._id } } }
    );

    // Mark family as inactive instead of deleting (for data integrity)
    family.isActive = false;
    await family.save();

    res.json({ message: 'Family deleted successfully' });

  } catch (error) {
    console.error('Delete family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/family/:familyId/leave - Leave family
router.post('/:familyId/leave', requireFamilyMember, async (req, res) => {
  try {
    const family = req.family;
    const userId = req.userId;

    // Check if user is the only admin
    const adminCount = family.members.filter(member => member.role === 'admin').length;
    const userMember = family.members.find(member => member.userId.toString() === userId.toString());
    
    if (userMember.role === 'admin' && adminCount === 1 && family.members.length > 1) {
      return res.status(400).json({
        message: 'Cannot leave family: You are the only admin. Please promote another member to admin first.'
      });
    }

    // Remove member from family
    await family.removeMember(userId);

    // Remove family from user's families array
    const user = await User.findById(userId);
    user.families = user.families.filter(f => f.familyId.toString() !== family._id.toString());
    await user.save();

    // If this was the last member, mark family as inactive
    if (family.members.length === 0) {
      family.isActive = false;
      await family.save();
    }

    res.json({ message: 'Successfully left family' });

  } catch (error) {
    console.error('Leave family error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/family/:familyId/members/:memberId/role - Update member role (admin only)
router.put('/:familyId/members/:memberId/role', requireFamilyAdmin, [
  body('role')
    .isIn(['admin', 'member'])
    .withMessage('Role must be either admin or member')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { role } = req.body;
    const { memberId } = req.params;
    const family = req.family;

    // Check if member exists
    if (!family.isUserMember(memberId)) {
      return res.status(404).json({ message: 'Member not found in family' });
    }

    // Update member role
    await family.updateMemberRole(memberId, role);

    // Update user's family role
    const user = await User.findById(memberId);
    const userFamily = user.families.find(f => f.familyId.toString() === family._id.toString());
    if (userFamily) {
      userFamily.role = role;
      await user.save();
    }

    await family.populate('members.userId', 'firstName lastName profilePicture');

    res.json({
      message: 'Member role updated successfully',
      family: family.toJSON()
    });

  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/family/:familyId/members/:memberId - Remove member from family (admin only)
router.delete('/:familyId/members/:memberId', requireFamilyAdmin, async (req, res) => {
  try {
    const { memberId } = req.params;
    const family = req.family;

    // Check if member exists
    if (!family.isUserMember(memberId)) {
      return res.status(404).json({ message: 'Member not found in family' });
    }

    // Don't allow removing yourself as admin if you're the only admin
    const adminCount = family.members.filter(member => member.role === 'admin').length;
    const memberToRemove = family.members.find(member => member.userId.toString() === memberId.toString());
    
    if (memberToRemove.role === 'admin' && adminCount === 1) {
      return res.status(400).json({
        message: 'Cannot remove the only admin from the family'
      });
    }

    // Remove member from family
    await family.removeMember(memberId);

    // Remove family from user's families array
    const user = await User.findById(memberId);
    if (user) {
      user.families = user.families.filter(f => f.familyId.toString() !== family._id.toString());
      await user.save();
    }

    await family.populate('members.userId', 'firstName lastName profilePicture');

    res.json({
      message: 'Member removed successfully',
      family: family.toJSON()
    });

  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/family/:familyId/locations - Get current locations of all family members
router.get('/:familyId/locations', requireFamilyMember, async (req, res) => {
  try {
    const family = await Family.findById(req.params.familyId)
      .populate('members.userId', 'firstName lastName profilePicture locationSettings');

    // Get member IDs who share their location
    const memberIds = family.members
      .filter(member => member.userId.locationSettings.shareLocation)
      .map(member => member.userId._id);

    // Get latest locations for these members
    const locations = await Location.getLatestForUsers(memberIds);

    // Format response with member info
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

    res.json({
      familyId: family._id,
      locations: familyLocations
    });

  } catch (error) {
    console.error('Get family locations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
