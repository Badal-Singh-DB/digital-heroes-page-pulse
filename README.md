# Page Pulse

A production-grade URL audit service that analyzes web pages for SEO, performance, and accessibility metrics.

## Features

- Input validation with Joi
- Request timeouts and concurrency limits
- Rate limiting per client
- Caching with configurable TTL
- Structured logging with request IDs
- Comprehensive error handling
- Health check endpoint

## API Contract

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "cacheStats": {
    "hits": 10,
    "misses": 5,
    "keys": 3
  }
}
```

### URL Audit

```
POST /api/audit
```

**Request Body:**
```json
{
  "url": "https://example.com",
  "options": {
    "timeout": 5000,
    "followRedirects": true,
    "checkSSL": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "score": 85,
  "cached": false,
  "requestId": "uuid-v4",
  "analysis": {
    "url": "https://example.com",
    "statusCode": 200,
    "loadTime": 234,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "metrics": {
      "title": "Example Domain",
      "metaDescription": "This domain is for use in illustrative examples...",
      "headings": { "h1": 1, "h2": 0, "h3": 0 },
      "images": { "total": 0, "withAlt": 0, "withoutAlt": 0 },
      "links": { "internal": 0, "external": 1, "broken": 0 },
      "scripts": 0,
      "stylesheets": 0
    },
    "seo": {
      "hasTitle": true,
      "hasMetaDescription": true,
      "hasCanonical": false,
      "hasRobots": false,
      "hasViewport": true
    },
    "performance": {
      "contentLength": "1256",
      "contentType": "text/html; charset=UTF-8",
      "hasGzip": false
    }
  }
}
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `CACHE_TTL` | 3600 | Cache TTL in seconds |
| `RATE_LIMIT_WINDOW` | 900000 | Rate limit window in ms |
| `RATE_LIMIT_MAX` | 100 | Max requests per window |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run linter
npm run lint
```

## License

MIT
