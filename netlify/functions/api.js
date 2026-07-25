const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');
const Joi = require('joi');
const axios = require('axios');
const cheerio = require('cheerio');
const serverless = require('serverless-http');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());

const auditSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required()
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/audit', async (req, res) => {
  const requestId = uuidv4();
  try {
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message, requestId });
    }

    const { url } = value;
    const cached = cache.get(url);
    if (cached) return res.json({ ...cached, cached: true, requestId });

    const start = Date.now();
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 10,
      validateStatus: () => true,
      headers: { 'User-Agent': 'PagePulse/1.0' }
    });

    const $ = cheerio.load(response.data);
    const loadTime = Date.now() - start;

    const analysis = {
      url, statusCode: response.status, loadTime,
      metrics: {
        title: $('title').text().trim() || null,
        metaDescription: $('meta[name="description"]').attr('content') || null,
        headings: { h1: $('h1').length, h2: $('h2').length, h3: $('h3').length },
        images: { total: $('img').length, withAlt: $('img[alt]').length },
        scripts: $('script').length,
        stylesheets: $('link[rel="stylesheet"]').length
      },
      seo: {
        hasTitle: !!$('title').text().trim(),
        hasMetaDescription: !!$('meta[name="description"]').attr('content'),
        hasCanonical: !!$('link[rel="canonical"]').attr('href'),
        hasViewport: !!$('meta[name="viewport"]').attr('content'),
        hasRobots: !!$('meta[name="robots"]').attr('content')
      },
      performance: {
        contentType: response.headers['content-type'] || 'unknown',
        hasGzip: response.headers['content-encoding'] === 'gzip'
      }
    };

    let score = 100;
    if (!analysis.seo.hasTitle) score -= 10;
    if (!analysis.seo.hasMetaDescription) score -= 10;
    if (!analysis.seo.hasCanonical) score -= 5;
    if (!analysis.seo.hasViewport) score -= 5;
    if (analysis.images && analysis.metrics.images.total > analysis.metrics.images.withAlt) score -= 5;
    if (loadTime > 3000) score -= 15;
    else if (loadTime > 1000) score -= 5;
    score = Math.max(0, Math.min(100, score));

    const result = { success: true, score, analysis };
    cache.set(url, result);
    res.json({ ...result, cached: false, requestId });

  } catch (err) {
    res.status(500).json({ error: err.message, requestId });
  }
});

module.exports.handler = serverless(app);
