const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const morgan = require('morgan');
const cookieparser = require('cookie-parser');
const compression = require('compression');
const tourRouter = require('./routes/tourRoutes');
const userRouter = require('./routes/userRoutes');
const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const reviewRouter = require('./routes/reviewRoutes');
const viewRouter = require('./routes/viewRoutes');
const bookingRouter = require('./routes/bookingRoutes');
const bookingController = require('./controllers/bookingController');

// Start Express
const app = express();

app.enable('trust proxy');
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
// GLOBAL MIDDLEWARE

// Implements CORS
app.use(cors()); //Access-control-origin * This allow all domain to access our API

// To allow specific domain, api.natours.com, frontend natours.com
// app.use(cors({
//   orgin: 'https:www.natours.com'
// }))

// Enable cors for non simple requests
app.options('*', cors());

// for specific resource
// app.options('/api/v1/tour/:id', cors())
// Serving static files
app.use(express.static(path.join(__dirname, 'public')));
// Set security HTTP headers
app.use(helmet());
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit request from same IP
const limit = rateLimit({
  max: 80,
  windowMs: 60 * 60 * 1000,
  message: 'Too many request from this IP, please try again after an hour!.',
});
app.use('/api', limit);

// Stripe webhooks
app.post(
  '/webhooks-checkout',
  express.raw({ type: 'application/json' }),
  bookingController.webHookCheckOut
);

// Body parser, read data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parser
app.use(cookieparser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS(Cross-sites-scripting attacks)
app.use(xss());

// Prevent HTTP parameter pollution
app.use(
  hpp({
    whitelist: [
      'duration',
      'ratingsAverage',
      'ratingsQuantity',
      'maxGroupSize',
      'difficulty',
      'price',
    ],
  })
);

// Compress all our response to the client
app.use(compression());

app.use('/', viewRouter);
app.use('/api/v1/tours', tourRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/bookings', bookingRouter);
app.all('*', (req, res, next) => {
  next(new AppError(404, `Can't find ${req.originalUrl} on this server😔`));
});

//Call Global error handler
app.use(globalErrorHandler);

module.exports = app;
