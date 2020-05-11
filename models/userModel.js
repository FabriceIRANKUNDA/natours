const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please tell us your name!'],
      maxlength: [50, 'Name must contain atmost only 50 characters!.'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, 'Please provide a valid email'],
    },
    photo: {
      type: String,
      default: 'default.jpg',
    },
    role: {
      type: String,
      enum: ['user', 'guide', 'lead-guide', 'admin'],
      default: 'user',
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [8, 'Password must contain at least 8 characters.'],
      select: false,
    },
    confirmPassword: {
      type: String,
      required: [true, 'Please confirm your password'],
      minlength: [8, 'Password must contain at least 8 characters.'],
      validate: {
        // This works only on CREATE && SAVE!!!
        validator: function (el) {
          return el === this.password;
        },
        message: 'Passwords are not the same!.',
      },
    },
    changedPasswordAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
    loginAttempt: {
      type: Number,
      default: 0,
    },
    waitingTime: Date,
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// virtual populate

userSchema.virtual('bookings', {
  ref: 'Booking',
  foreignField: 'user',
  localField: '_id',
});

userSchema.pre('save', async function (next) {
  // Only run this function actually if password is modified
  if (!this.isModified('password')) return next();

  // Hash the password
  this.password = await bcrypt.hash(this.password, 11);

  // Delete the password confirm field
  this.confirmPassword = undefined;

  next();
});

userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.changedPasswordAt = Date.now() - 1000;
  next();
});

userSchema.pre(/^find/, function (next) {
  // Points the document with active status
  this.find({ active: { $ne: false } });
  next();
});
userSchema.methods.isCorrectPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAftr = (JWTTimeStamp) => {
  if (this.changedPasswordAt) {
    const changedTimeStamp = parseInt(
      this.changedPasswordAt.getTime() / 1000,
      10
    );
    return JWTTimeStamp < changedTimeStamp;
  }
  // False means Not changed
  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  // Generate a random token
  const resetToken = crypto.randomBytes(32).toString('hex');
  // Store encrypted token to the database
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  // Estimate the expire time of the token
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; //convert into millseconds

  return resetToken;
};
userSchema.methods.createWaitingTime = async function () {
  if (this.waitingTime) return;
  this.waitingTime = Date.now() + 10 * 60 * 1000;
  await this.save({ validateBeforeSave: false });
};
const User = mongoose.model('User', userSchema);

module.exports = User;
