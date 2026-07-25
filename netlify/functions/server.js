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
const serverless = require('serverless-http');

const app = express();
const router = express.Router();

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Cache configuration
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 3600;
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

// Middleware
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Validation schema
const auditSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  options: Joi.object({
    timeout: Joi.number().integer().min(1000).max(30000).default(5000),
    followRedirects: Joi.boolean().default(true),
    checkSSL: Joi.boolean().default(true)
  }).default()
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cacheStats: cache.getStats()
  });
});

// Audit endpoint
router.post('/api/audit', async (req, res) => {
  const requestId = uuidv4();

  try {
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
        requestId
      });
    }

    const { url, options } = value;
    const cacheKey = `audit:${url}:${JSON.stringify(options)}`;
    const cachedResult = cache.get(cacheKey);

    if (cachedResult) {
      return res.json({ ...cachedResult, cached: true, requestId });
    }

    const auditResult = await performAudit(url, options, requestId);
    cache.set(cacheKey, auditResult);

    res.json({ ...auditResult, cached: false, requestId });

  } catch (err) {
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

  const response = await axios.get(url, {
    timeout: options.timeout,
    maxRedirects: options.followRedirects ? 10 : 0,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'PagePulse/1.0 URL Audit Service'
    }
  });

  const $ = cheerio.load(response.data);
  const loadTime = Date.now() - startTime;

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
      links: { internal: 0, external: 0, broken: 0 },
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

  const score = calculateScore(analysis);

  return { success: true, score, analysis };
}

function calculateScore(analysis) {
  let score = 100;
  if (!analysis.seo.hasTitle) score -= 10;
  if (!analysis.seo.hasMetaDescription) score -= 10;
  if (!analysis.seo.hasCanonical) score -= 5;
  if (!analysis.seo.hasViewport) score -= 5;
  if (analysis.metrics.images.withoutAlt > 0) score -= analysis.metrics.images.withoutAlt * 2;
  if (analysis.loadTime > 3000) score -= 15;
  else if (analysis.loadTime > 1000) score -= 5;
  if (analysis.seo.hasRobots) score += 5;
  if (analysis.performance.hasGzip) score += 5;
  return Math.max(0, Math.min(100, score));
}

app.use('/.netlify/functions/server', router);

module.exports.handler = serverless(app);
