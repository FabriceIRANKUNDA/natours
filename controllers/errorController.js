/*eslint-disable*/

// Global error handler
const AppError = require('../utils/appError');

const handleTokenExpErr = () =>
  new AppError(401, 'Your token is expired please login again!');
const handleJsonWebTokenError = () =>
  new AppError(401, 'Invalid token please login again!.');

const handleCastErrorDB = (error) => {
  const message = `Invalid ${error.path}: ${error.value}`;
  return new AppError(400, message);
};

const handleDuplicateFieldsErrorDB = (error) => {
  const value = error.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(400, message);
};

const handleValidationErrorDB = (error) => {
  const errors = Object.values(error.errors).map((el) => el.message);
  const message = `Invalid input. ${errors.join('. ')}`;
  return new AppError(400, message);
};
const sendDevErr = (err, req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  } else {
    console.error('ERROR💥', err);
    res.status(err.statusCode).render('error', {
      title: 'Something wrong happen!',
      msg: err.message,
    });
  }
};

const sendProErr = (err, req, res) => {
  // A) Operational, trusted error: send message to the client
  if (req.originalUrl.startsWith('/api')) {
    if (err.isOperational) {
      return res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
      });
    }
    // B) Programming or other unknown error: don't leak error details
    // 1) Log error
    console.error('ERROR💥', err);
    // 2) Send generic message
    return res.status(500).json({
      status: 'Error',
      message: 'Something went very wrong!',
    });
  }
  // A) Operational, trusted error: send message to the client
  if (err.isOperational) {
    res.status(err.statusCode).render('error', {
      title: 'Something wrong happen!',
      msg: err.message,
    });
  } else {
    // B) Programming or other unknown error: don't leak error details
    // 1) Log error
    console.error('ERROR💥', err);
    // 2) Send generic message
    res.status(500).render('error', {
      title: 'Something wrong happen!',
      msg: 'Please try again later!',
    });
  }
};
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';
  if (process.env.NODE_ENV.startsWith('p')) {
    let error = { ...err };
    if (error.name === 'CastError') error = handleCastErrorDB();
    if (error.code === 11000) error = handleDuplicateFieldsErrorDB();
    if (error.name === 'ValidationError')
      error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError')
      error = handleJsonWebTokenError(error);
    if (error.name === 'TokenExpiredError') error = handleTokenExpErr(error);
    sendProErr(error, req, res);
  } else if (process.env.NODE_ENV === 'development') {
    sendDevErr(err, req, res);
  }
};
