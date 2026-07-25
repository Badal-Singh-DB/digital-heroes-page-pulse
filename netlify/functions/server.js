const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');
const Joi = require('joi');
const axios = require('axios');
const cheerio = require('cheerio');
const serverless = require('serverless-http');

const app = express();
const router = express.Router();

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());

const auditSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  options: Joi.object({
    timeout: Joi.number().integer().min(1000).max(30000).default(5000),
    followRedirects: Joi.boolean().default(true),
    checkSSL: Joi.boolean().default(true)
  }).default()
});

router.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

router.post('/api/audit', async (req, res) => {
  const requestId = uuidv4();
  try {
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation failed', details: error.details.map(d => d.message), requestId });
    }

    const { url, options } = value;
    const cacheKey = `audit:${url}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true, requestId });

    const startTime = Date.now();
    const response = await axios.get(url, {
      timeout: options.timeout,
      maxRedirects: options.followRedirects ? 10 : 0,
      validateStatus: () => true,
      headers: { 'User-Agent': 'PagePulse/1.0' }
    });

    const $ = cheerio.load(response.data);
    const loadTime = Date.now() - startTime;

    const analysis = {
      url, statusCode: response.status, loadTime, timestamp: new Date().toISOString(),
      metrics: {
        title: $('title').text().trim() || null,
        metaDescription: $('meta[name="description"]').attr('content') || null,
        headings: { h1: $('h1').length, h2: $('h2').length, h3: $('h3').length },
        images: { total: $('img').length, withAlt: $('img[alt]').length, withoutAlt: $('img:not([alt])').length },
        scripts: $('script').length, stylesheets: $('link[rel="stylesheet"]').length
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
    score = Math.max(0, Math.min(100, score));

    const result = { success: true, score, analysis };
    cache.set(cacheKey, result);
    res.json({ ...result, cached: false, requestId });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error', message: err.message, requestId });
  }
});

app.use('/.netlify/functions/server', router);
app.use('/', express.static('.'));

module.exports.handler = serverless(app);
