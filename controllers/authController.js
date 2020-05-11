const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;
  res.cookie('jwt', token, cookieOptions);

  user.password = undefined;
  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};
exports.signUp = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
    role: req.body.role,
  });

  const url = `${req.protocol}://${req.get('host')}/me`;
  await new Email(newUser, url).sendWelcome();
  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  // 1) Check if email and password are suppplied

  if (!email || !password) {
    return next(new AppError(400, 'Please provide email and password'));
  }
  // 2) Chect if user exit and password is correct
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return next(
      new AppError(
        404,
        'Please make sure you have an account!, Go ahead to /signup'
      )
    );
  }
  if (!(await user.isCorrectPassword(password, user.password))) {
    user.loginAttempt += 1;
    if (user.loginAttempt >= 4) {
      user.createWaitingTime();
      return next(
        new AppError(
          401,
          `Your tried ${user.loginAttempt} times with invalid credential, try again in ten minutes`
        )
      );
    }
    await user.save({ validateBeforeSave: false });
    return next(new AppError(401, 'Incorrect email or Password'));
  }
  if (user.waitingTime > Date.now()) {
    return next(
      new AppError(
        401,
        `Your tried ${user.loginAttempt} times with invalid credential, try again in ten minutes`
      )
    );
  }
  user.waitingTime = undefined;
  user.loginAttempt = undefined;
  user.save({ validateBeforeSave: false });

  // 3) If everything is OK, send token to the client
  createSendToken(user, 200, res);
});

exports.logout = (req, res) => {
  res.cookie('jwt', 'logged out', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    status: 'success',
  });
};

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check if it exist
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }
  if (!token) {
    return next(
      new AppError(401, 'You are not logged in! Please login to get access')
    );
  }
  // 2) Verify the token
  const decodedPayload = await promisify(jwt.verify)(
    token,
    process.env.JWT_SECRET
  );
  // 3) Check if user stills exist
  const currentUser = await User.findById(decodedPayload.id);
  if (!currentUser) {
    return next(
      new AppError(401, 'Token belongs to the user who is no longer exist!.')
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAftr(decodedPayload.iat)) {
    return new AppError(
      401,
      'User recently changed the password! Please login again.'
    );
  }

  //GRANT ACCESS TO THE PROTECTED ROUTE
  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

exports.isLoggedIn = async (req, res, next) => {
  // 1) Getting token and check if it exist
  if (req.cookies.jwt) {
    try {
      // 2) Verify the token
      const decodedPayload = await promisify(jwt.verify)(
        req.cookies.jwt,
        process.env.JWT_SECRET
      );

      // 3) Check if user stills exist
      const currentUser = await User.findById(decodedPayload.id);
      if (!currentUser) {
        return next();
      }

      // 4) Check if user changed password after the token was issued
      if (currentUser.changedPasswordAftr(decodedPayload.iat)) {
        return next();
      }

      // IF THERE IS A LOGGED IN USER ADD HIM/HER TO LOCALS TO ACCESS HIM/HER IN PUG TEMPLATES
      res.locals.user = currentUser;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};

exports.restrictTo = (...roles) => {
  // Properity of closure will allow to use roles in our middleware
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return next(
        new AppError(403, 'You do not have permission to perfom this action.')
      );
    next();
  };
};

exports.forgetPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user)
    return next(
      new AppError(404, 'There is no user with a given email address.')
    );

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}`;

  // Call sendEmail
  try {
    await new Email(user, resetURL).sendPasswordReset();
    res.status(200).json({
      status: 'success',
      message: 'Token sent to the email',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        500,
        'There was an error while sending email!. Please try again later.'
      )
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1. Get the user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  // 2. Check if the token has not expired, and there is user, set new password
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) {
    return next(new AppError(400, 'Invalid token or has expired!.'));
  }
  user.password = req.body.password;
  user.confirmPassword = req.body.confirmPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  // 3. Update changedPasswordAt property of the user

  // 4. Log the user in, send JWt
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // Get user from the collection
  const user = await User.findById(req.user.id).select('+password');

  // Check whether the current password is correct
  if (!(await user.isCorrectPassword(req.body.password, user.password))) {
    return next(new AppError(401, 'Current password is wrong!'));
  }

  // Update the password
  user.password = req.body.newPassword;
  user.confirmPassword = req.body.confirmNewPassword;
  await user.save();

  // Send response. or send Token
  createSendToken(user, 200, res);
});
