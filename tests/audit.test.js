const request = require('supertest');
const app = require('../src/index');

describe('Page Pulse API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('POST /api/audit', () => {
    it('should return 400 for invalid URL', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ url: 'not-a-valid-url' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('should return 400 for missing URL', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({});
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for non-http URL', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ url: 'ftp://example.com' });
      expect(res.statusCode).toBe(400);
    });

    it('should audit a valid URL', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ url: 'https://example.com' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('score');
      expect(res.body).toHaveProperty('analysis');
      expect(res.body.analysis.url).toBe('https://example.com');
    }, 10000);

    it('should handle timeout option', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ 
          url: 'https://example.com',
          options: { timeout: 2000 }
        });
      expect(res.statusCode).toBe(200);
    }, 10000);
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
