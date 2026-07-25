const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const NodeCache = require('node-cache');
const Joi = require('joi');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Cache configuration (configurable window)
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 3600; // Default 1 hour
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

// Rate limiting per client
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(limiter);
app.use(express.static(path.join(__dirname, '../public')));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.startTime = Date.now();
  
  // Log request
  logger.info('Request received', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info('Request completed', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
});

// Validation schema for URL audit
const auditSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  options: Joi.object({
    timeout: Joi.number().integer().min(1000).max(30000).default(5000),
    followRedirects: Joi.boolean().default(true),
    checkSSL: Joi.boolean().default(true)
  }).default()
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Page Pulse',
    version: '1.0.0',
    description: 'Production-grade URL audit service',
    endpoints: {
      health: '/health',
      audit: '/api/audit (POST)'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cacheStats: cache.getStats()
  });
});

// Main audit endpoint
app.post('/api/audit', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    // Validate input
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      logger.warn('Validation error', { requestId, error: error.details });
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
        requestId
      });
    }

    const { url, options } = value;
    
    // Check cache first
    const cacheKey = `audit:${url}:${JSON.stringify(options)}`;
    const cachedResult = cache.get(cacheKey);
    
    if (cachedResult) {
      logger.info('Cache hit', { requestId, url });
      return res.json({
        ...cachedResult,
        cached: true,
        requestId
      });
    }

    // Perform audit
    const auditResult = await performAudit(url, options, requestId);
    
    // Cache the result
    cache.set(cacheKey, auditResult);
    
    logger.info('Audit completed', { requestId, url, score: auditResult.score });
    
    res.json({
      ...auditResult,
      cached: false,
      requestId
    });

  } catch (err) {
    logger.error('Audit failed', { requestId, error: err.message });
    
    if (err.code === 'ECONNABORTED') {
      return res.status(408).json({
        error: 'Request timeout',
        message: 'The URL took too long to respond',
        requestId
      });
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      requestId
    });
  }
});

// Audit function
async function performAudit(url, options, requestId) {
  const startTime = Date.now();
  
  try {
    // Fetch URL with timeout and redirect options
    const response = await axios.get(url, {
      timeout: options.timeout,
      maxRedirects: options.followRedirects ? 10 : 0,
      validateStatus: () => true, // Don't throw for any status code
      headers: {
        'User-Agent': 'PagePulse/1.0 URL Audit Service'
      }
    });

    const $ = cheerio.load(response.data);
    const loadTime = Date.now() - startTime;

    // Analyze page
    const analysis = {
      url,
      statusCode: response.status,
      loadTime,
      timestamp: new Date().toISOString(),
      metrics: {
        title: $('title').text().trim() || null,
        metaDescription: $('meta[name="description"]').attr('content') || null,
        headings: {
          h1: $('h1').length,
          h2: $('h2').length,
          h3: $('h3').length
        },
        images: {
          total: $('img').length,
          withAlt: $('img[alt]').length,
          withoutAlt: $('img:not([alt])').length
        },
        links: {
          internal: 0,
          external: 0,
          broken: 0
        },
        scripts: $('script').length,
        stylesheets: $('link[rel="stylesheet"]').length
      },
      seo: {
        hasTitle: !!$('title').text().trim(),
        hasMetaDescription: !!$('meta[name="description"]').attr('content'),
        hasCanonical: !!$('link[rel="canonical"]').attr('href'),
        hasRobots: !!$('meta[name="robots"]').attr('content'),
        hasViewport: !!$('meta[name="viewport"]').attr('content')
      },
      performance: {
        contentLength: response.headers['content-length'] || 'unknown',
        contentType: response.headers['content-type'] || 'unknown',
        hasGzip: response.headers['content-encoding'] === 'gzip'
      }
    };

    // Calculate score
    const score = calculateScore(analysis);
    
    return {
      success: true,
      score,
      analysis
    };

  } catch (err) {
    throw err;
  }
}

// Score calculation
function calculateScore(analysis) {
  let score = 100;
  
  // Deductions
  if (!analysis.seo.hasTitle) score -= 10;
  if (!analysis.seo.hasMetaDescription) score -= 10;
  if (!analysis.seo.hasCanonical) score -= 5;
  if (!analysis.seo.hasViewport) score -= 5;
  if (analysis.metrics.images.withoutAlt > 0) score -= analysis.metrics.images.withoutAlt * 2;
  if (analysis.loadTime > 3000) score -= 15;
  else if (analysis.loadTime > 1000) score -= 5;
  
  // Bonus
  if (analysis.seo.hasRobots) score += 5;
  if (analysis.performance.hasGzip) score += 5;
  
  return Math.max(0, Math.min(100, score));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Page Pulse server running on port ${PORT}`);
    console.log(`Page Pulse server running on port ${PORT}`);
  });
}

module.exports = app;
