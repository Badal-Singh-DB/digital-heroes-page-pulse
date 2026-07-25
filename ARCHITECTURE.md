# Page Pulse - Architecture Document

## Task B: Design it for Scale

### Overview

This document outlines the architecture for scaling Page Pulse to handle 10,000 audits per day with bursts of 500 concurrent requests and a customer-facing SLA on response time.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                    │
│                    (Web/Mobile/API Users)                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LOAD BALANCER                                │
│                   (AWS ALB / Cloudflare)                            │
│              - SSL Termination                                      │
│              - DDoS Protection                                      │
│              - Rate Limiting (Edge)                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY                                 │
│                    (Kong / AWS API Gateway)                         │
│              - Authentication                                        │
│              - Request Validation                                    │
│              - Rate Limiting (Per Client)                            │
│              - Request Routing                                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                               │
│                   (Node.js Cluster)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   Worker 1  │  │   Worker 2  │  │   Worker N  │                 │
│  │  (Audit)    │  │  (Audit)    │  │  (Audit)    │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   MESSAGE QUEUE     │ │   CACHE LAYER       │ │   DATABASE          │
│   (Redis/RabbitMQ)  │ │   (Redis Cluster)   │ │   (PostgreSQL)      │
│   - Job Queue       │ │   - Session Cache   │ │   - Audit History   │
│   - Rate Limiting   │ │   - Result Cache    │ │   - User Data       │
│   - Pub/Sub         │ │   - Config Cache    │ │   - Analytics       │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     WORKER POOL                                     │
│                   (Background Jobs)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  Worker 1   │  │  Worker 2   │  │  Worker N   │                 │
│  │  (Crawler)  │  │  (Crawler)  │  │  (Crawler)  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                               │
│              - Target Websites (HTTP/HTTPS)                         │
│              - DNS Resolution                                       │
│              - SSL Validation                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow

### Request Flow

1. **Client Request** → Load Balancer (SSL termination, DDoS protection)
2. **Load Balancer** → API Gateway (authentication, validation, rate limiting)
3. **API Gateway** → Application Layer (request handling)
4. **Application Layer** → Cache Layer (check for cached result)
5. **Cache Miss** → Message Queue (enqueue audit job)
6. **Message Queue** → Worker Pool (process audit job)
7. **Worker Pool** → External Services (fetch target URL)
8. **Worker Pool** → Database (store results)
9. **Worker Pool** → Cache Layer (cache results)
10. **Application Layer** → Client (return results)

### Data Storage

- **Redis Cache**: Frequently accessed audit results, rate limiting counters, session data
- **PostgreSQL**: Audit history, user data, configuration, analytics
- **Message Queue**: Pending audit jobs, retry queues

---

## 3. Technology Choices

### Primary Stack

| Component | Technology | Justification |
|-----------|------------|---------------|
| **Runtime** | Node.js | Non-blocking I/O, excellent for concurrent HTTP requests |
| **Framework** | Express.js | Mature, well-documented, extensive middleware ecosystem |
| **Cache** | Redis | In-memory performance, pub/sub capabilities, clustering support |
| **Database** | PostgreSQL | ACID compliance, JSON support, excellent for analytics |
| **Queue** | Redis Streams | Lightweight, integrates with existing Redis, supports consumer groups |
| **Load Balancer** | AWS ALB | Managed service, auto-scaling, SSL termination |
| **Container** | Docker | Consistent environments, easy scaling |
| **Orchestration** | Kubernetes | Auto-scaling, self-healing, rolling updates |

### Alternatives Considered

| Component | Alternative | Rejection Reason |
|-----------|-------------|------------------|
| **Runtime** | Go | Higher learning curve, smaller ecosystem for web scraping |
| **Cache** | Memcached | Lacks persistence, pub/sub, and advanced data structures |
| **Database** | MongoDB | Less suitable for relational data, weaker ACID guarantees |
| **Queue** | RabbitMQ | Higher operational overhead, Redis already in stack |
| **Load Balancer** | Nginx | Requires more manual configuration, less integration with cloud services |

---

## 4. Scaling Strategy

### Horizontal Scaling

- **Application Layer**: Stateless workers behind load balancer
- **Worker Pool**: Independent workers consuming from message queue
- **Cache Layer**: Redis Cluster with sharding
- **Database**: Read replicas, connection pooling

### Vertical Scaling

- **Application Servers**: Increase CPU/RAM for higher throughput
- **Database**: Upgrade instance type for better performance
- **Cache**: Increase memory for larger cache size

### Auto-scaling Configuration

```yaml
# Kubernetes HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: page-pulse-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: page-pulse-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 5. Failure Modes and Mitigations

### Failure Mode 1: Cache Outage

**Impact**: All requests hit database, increased latency, potential DB overload

**Mitigation**:
- Implement cache-aside pattern with graceful degradation
- Circuit breaker to stop cache attempts after failures
- Fallback to database with rate limiting
- Monitor cache hit ratio and alert on degradation

### Failure Mode 2: Message Queue Backlog

**Impact**: Audit jobs pile up, increased response times

**Mitigation**:
- Monitor queue depth and consumer lag
- Auto-scale workers based on queue size
- Implement job priority and timeouts
- Dead letter queue for failed jobs

### Failure Mode 3: Target Website Unreachable

**Impact**: Audit jobs fail, worker resources wasted

**Mitigation**:
- Request timeouts (5-10 seconds)
- Circuit breaker for frequently failing domains
- Retry with exponential backoff
- Mark domain as temporarily unavailable

### Failure Mode 4: Database Overload

**Impact**: Slow queries, connection timeouts, data loss

**Mitigation**:
- Connection pooling with limits
- Read replicas for query distribution
- Query optimization and indexing
- Async writes for non-critical data

---

## 6. Monitoring and Alerting

### Key Metrics

| Metric | Threshold | Alert |
|--------|-----------|-------|
| Response Time (p95) | > 2s | Warning |
| Response Time (p99) | > 5s | Critical |
| Error Rate | > 1% | Warning |
| Error Rate | > 5% | Critical |
| Cache Hit Ratio | < 80% | Warning |
| Queue Depth | > 1000 | Warning |
| Queue Depth | > 5000 | Critical |
| CPU Utilization | > 70% | Warning |
| Memory Utilization | > 80% | Warning |

### Monitoring Stack

- **Prometheus**: Metrics collection
- **Grafana**: Visualization and dashboards
- **ELK Stack**: Log aggregation and analysis
- **PagerDuty**: Alert management and escalation

### Logging Strategy

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info",
  "requestId": "uuid-v4",
  "message": "Audit completed",
  "metadata": {
    "url": "https://example.com",
    "duration": 234,
    "score": 85,
    "worker": "worker-1"
  }
}
```

---

## 7. Rollback Plan

### Deployment Strategy

- **Blue-Green Deployment**: Zero-downtime deployments
- **Canary Releases**: Gradual traffic shifting
- **Feature Flags**: Toggle features without deployment

### Rollback Procedures

1. **Immediate Rollback** (< 5 minutes)
   - Revert to previous container image
   - Update load balancer to point to old version
   - Verify health checks pass

2. **Database Rollback** (< 30 minutes)
   - Run reverse migrations
   - Restore from point-in-time backup
   - Update application configuration

3. **Full Rollback** (< 1 hour)
   - Restore infrastructure from backup
   - Redeploy all services
   - Verify data integrity

### Rollback Triggers

- Error rate > 5% for 5 minutes
- Response time > 10s for 5 minutes
- Health check failures > 3
- Data corruption detected

---

## 8. SLA Commitments

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.9% | Monthly uptime |
| Response Time (p95) | < 2s | 95th percentile |
| Response Time (p99) | < 5s | 99th percentile |
| Error Rate | < 0.1% | Failed requests |
| Recovery Time | < 30 min | Mean time to recover |

---

## 9. Cost Optimization

- **Spot Instances**: Use for worker pool (70% cost savings)
- **Reserved Instances**: Use for always-on services (40% cost savings)
- **Auto-scaling**: Scale down during low traffic
- **Caching**: Reduce database load and external API calls
- **Compression**: Reduce bandwidth usage

---

## 10. Security Considerations

- **Rate Limiting**: Prevent abuse at multiple levels
- **Input Validation**: Sanitize all user inputs
- **Authentication**: API key or OAuth2 for authenticated users
- **Encryption**: TLS for data in transit, encryption at rest
- **Audit Logging**: Track all API access and changes

---

*Built for Digital Heroes Training Task*
