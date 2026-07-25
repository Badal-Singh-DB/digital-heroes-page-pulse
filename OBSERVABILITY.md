# Observability and Rollback Plan

## Overview

This document defines the monitoring, alerting, and rollback procedures for the Page Pulse service at scale.

---

## 1. Observability Strategy

### Three Pillars

1. **Metrics**: Quantitative measurements of system behavior
2. **Logs**: Detailed event records for debugging
3. **Traces**: Request flow through the system

### Observability Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Metrics** | Prometheus | Collect and store time-series data |
| **Visualization** | Grafana | Dashboards and graphs |
| **Logging** | ELK Stack | Centralized log aggregation |
| **Tracing** | Jaeger | Distributed tracing |
| **Alerting** | PagerDuty | Alert management |

---

## 2. Key Metrics

### Application Metrics

| Metric | Description | Collection Interval |
|--------|-------------|---------------------|
| `http_requests_total` | Total HTTP requests | Real-time |
| `http_request_duration_seconds` | Request latency | Real-time |
| `http_requests_by_status` | Requests by status code | Real-time |
| `audit_score_average` | Average audit score | 5 minutes |
| `audit_duration_seconds` | Audit execution time | Real-time |

### Infrastructure Metrics

| Metric | Description | Collection Interval |
|--------|-------------|---------------------|
| `node_cpu_seconds_total` | CPU usage | 15 seconds |
| `node_memory_MemAvailable_bytes` | Available memory | 15 seconds |
| `node_network_receive_bytes_total` | Network traffic | 15 seconds |
| `container_fs_usage_bytes` | Disk usage | 1 minute |

### Business Metrics

| Metric | Description | Collection Interval |
|--------|-------------|---------------------|
| `audits_per_day` | Daily audit count | 1 hour |
| `active_users` | Concurrent users | 5 minutes |
| `cache_hit_ratio` | Cache efficiency | 5 minutes |
| `queue_depth` | Pending jobs | 1 minute |

---

## 3. Alerting Rules

### Critical Alerts (Page immediately)

```yaml
groups:
  - name: critical
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          
      - alert: HighLatency
        expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "99th percentile latency > 5s"
          
      - alert: CacheDown
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis cache is down"
```

### Warning Alerts (Notify team)

```yaml
groups:
  - name: warning
    rules:
      - alert: HighQueueDepth
        expr: queue_depth > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Queue depth exceeding threshold"
          
      - alert: LowCacheHitRatio
        expr: cache_hit_ratio < 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit ratio below 80%"
          
      - alert: HighCPU
        expr: node_cpu_seconds_total > 0.7
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "CPU usage above 70%"
```

---

## 4. Logging Strategy

### Log Levels

| Level | Usage | Retention |
|-------|-------|-----------|
| **ERROR** | System errors, exceptions | 30 days |
| **WARN** | Unexpected conditions | 14 days |
| **INFO** | Normal operations | 7 days |
| **DEBUG** | Debug information | 1 day |

### Log Format

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info",
  "service": "page-pulse",
  "requestId": "uuid-v4",
  "message": "Audit completed",
  "metadata": {
    "url": "https://example.com",
    "duration": 234,
    "score": 85
  }
}
```

### Log Aggregation

- **Collection**: Filebeat agents on each node
- **Processing**: Logstash for parsing and enrichment
- **Storage**: Elasticsearch for indexing
- **Visualization**: Kibana for search and analysis

---

## 5. Distributed Tracing

### Trace Propagation

- Use W3C Trace Context headers
- Propagate trace ID through all services
- Sample 1% of requests in production

### Span Attributes

```json
{
  "traceId": "abc123",
  "spanId": "def456",
  "operationName": "audit_url",
  "duration": 234,
  "tags": {
    "url": "https://example.com",
    "statusCode": 200,
    "cacheHit": false
  }
}
```

---

## 6. Rollback Procedures

### Pre-deployment Checklist

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Rollback plan documented
- [ ] Monitoring configured
- [ ] Alerts configured

### Deployment Strategy

#### Blue-Green Deployment

1. **Deploy New Version**: Deploy to green environment
2. **Run Tests**: Execute smoke tests on green
3. **Switch Traffic**: Gradually shift traffic from blue to green
4. **Monitor**: Watch metrics for anomalies
5. **Complete**: Fully switch to green, keep blue for rollback

#### Canary Deployment

1. **Deploy Canary**: Deploy new version to small subset
2. **Monitor**: Compare canary metrics with baseline
3. **Gradually Increase**: Increase traffic to canary
4. **Complete**: Fully deploy if metrics are stable

### Rollback Triggers

| Condition | Action | Timeframe |
|-----------|--------|-----------|
| Error rate > 5% | Immediate rollback | < 5 minutes |
| Latency p99 > 10s | Immediate rollback | < 5 minutes |
| Health check failures | Immediate rollback | < 5 minutes |
| Data corruption | Immediate rollback + investigation | < 5 minutes |
| Memory leak | Planned rollback | < 30 minutes |

### Rollback Steps

#### Immediate Rollback (< 5 minutes)

```bash
# 1. Identify current version
kubectl rollout history deployment/page-pulse-api

# 2. Rollback to previous version
kubectl rollout undo deployment/page-pulse-api

# 3. Verify rollback
kubectl rollout status deployment/page-pulse-api

# 4. Monitor metrics
# Check Grafana dashboard for stability
```

#### Database Rollback (< 30 minutes)

```bash
# 1. Stop application traffic
kubectl scale deployment/page-pulse-api --replicas=0

# 2. Run reverse migration
npm run migrate:down

# 3. Restore from backup (if needed)
pg_restore -d page_pulse backup.dump

# 4. Restart application
kubectl scale deployment/page-pulse-api --replicas=3
```

#### Full Rollback (< 1 hour)

```bash
# 1. Restore infrastructure
terraform apply -target=module.page_pulse -var="version=previous"

# 2. Redeploy application
kubectl apply -f k8s/previous/

# 3. Verify data integrity
npm run verify:data

# 4. Resume traffic
kubectl scale deployment/page-pulse-api --replicas=3
```

### Post-rollback Actions

1. **Incident Report**: Document what went wrong
2. **Root Cause Analysis**: Identify underlying issues
3. **Fix Issues**: Address problems before re-deploying
4. **Update Monitoring**: Add alerts for similar issues
5. **Team Review**: Discuss lessons learned

---

## 7. Communication Plan

### During Incident

| Audience | Channel | Frequency |
|----------|---------|-----------|
| Engineering Team | Slack #incidents | Every 15 minutes |
| Management | Email | Every 30 minutes |
| Customers | Status page | Every 1 hour |

### Incident Template

```
**Incident Report**

**Title**: [Brief description]
**Severity**: [Critical/High/Medium/Low]
**Status**: [Investigating/Identified/Monitoring/Resolved]
**Impact**: [Description of impact]
**Timeline**: [Key events]
**Next Update**: [Time]
```

---

## 8. Runbooks

### Runbook: High Error Rate

1. **Identify**: Check error logs for common patterns
2. **Isolate**: Determine if specific endpoints are affected
3. **Mitigate**: Scale up or rollback if needed
4. **Fix**: Address root cause
5. **Verify**: Confirm metrics return to normal

### Runbook: Cache Outage

1. **Check**: Verify Redis health and connectivity
2. **Restart**: Restart Redis if needed
3. **Warm**: Pre-populate cache with critical data
4. **Monitor**: Watch for recovery
5. **Optimize**: Review cache configuration

### Runbook: Queue Backlog

1. **Scale**: Add more workers
2. **Prioritize**: Process critical jobs first
3. **Clear**: Remove stuck jobs
4. **Monitor**: Watch queue depth reduction
5. **Optimize**: Review job processing logic

---

*Built for Digital Heroes Training Task*
