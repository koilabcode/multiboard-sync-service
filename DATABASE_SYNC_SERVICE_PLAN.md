# Multiboard Database Sync Service - Implementation Plan

## ⚠️ CONFIDENTIAL - DO NOT COMMIT TO GIT
This document contains sensitive information and credentials. It has been added to .gitignore.

---

## Executive Summary

The current database sync feature at https://parts-cms.koilab.com/sync-database has critical limitations for Vercel deployment:
- Uses `psql` shell commands (not available on Vercel)
- CSV format is fragile (encoding/escaping issues)
- Memory constraints with large datasets
- Execution time limits (10s-300s on Vercel)
- No persistent filesystem for temporary files

This document outlines a complete rewrite as a separate, robust service that can handle enterprise-scale database operations.

---

## Current System Analysis

### Existing Implementation Issues
1. **Shell Dependencies**: Uses `exec` with `psql` commands
2. **CSV Format**: Prone to data corruption with special characters
3. **Memory Usage**: Loads entire tables into memory
4. **No Streaming**: Cannot handle databases > 1GB efficiently
5. **Vercel Incompatible**: Requires binaries and long execution times

### Current File Locations
- Frontend: `/apps/admin/app/(dashboard)/sync-database/page.tsx`
- Export API: `/apps/admin/app/api/sync-database/export/route.ts`
- Import API: `/apps/admin/app/api/sync-database/import/route.ts`
- Config: `/apps/admin/lib/config/databases.ts`

---

## Proposed Architecture

### Service Separation Strategy

```
Current Monolith                    New Architecture
================                    ================
multiboard_main/                    multiboard_main/ (unchanged)
└── apps/                          +
    └── admin/                      multiboard-sync-service/ (NEW)
        └── sync-database/          ├── apps/
            (all-in-one)            │   ├── web/ (UI)
                                   │   └── worker/ (Heavy ops)
                                   └── packages/
                                       └── db-sync/ (Core logic)
```

---

## Technology Stack Decision

### Backend Language Comparison

| Criteria | Node.js/TypeScript | Go | Python |
|----------|-------------------|-----|---------|
| Performance | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Memory Usage | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Concurrency | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Team Familiarity | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| PostgreSQL Support | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Streaming Data | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

**Recommendation**: Go for performance-critical worker, Node.js for UI/API

### Hosting Platform Comparison

| Platform | Cost/Month | Pros | Cons | Recommendation |
|----------|------------|------|------|----------------|
| AWS ECS Fargate | $50-70 | Full control, auto-scaling | Complex setup | ⭐⭐⭐⭐⭐ |
| Railway | $40-60 | Simple deployment, managed | Less control | ⭐⭐⭐⭐ |
| Render | $40-60 | Good DX, auto-deploy | Limited regions | ⭐⭐⭐⭐ |
| DigitalOcean VPS | $30 | Cheapest, full control | Manual management | ⭐⭐⭐ |

**Recommendation**: Start with Railway for quick deployment, migrate to AWS for scale

---

## Implementation Plan

### Phase 1: Project Setup (Week 1)

#### 1.1 Repository Structure
```bash
# Create new repository
mkdir multiboard-sync-service
cd multiboard-sync-service
git init

# Directory structure
mkdir -p apps/{web,worker}
mkdir -p packages/{db-sync,shared,storage}
mkdir -p infrastructure/{docker,terraform}
mkdir -p docs
```

#### 1.2 Technology Stack
```json
{
  "monorepo": "turborepo + pnpm",
  "ui": {
    "framework": "Next.js 15",
    "styling": "Tailwind CSS",
    "components": "shadcn/ui"
  },
  "worker": {
    "language": "Go 1.21",
    "framework": "Fiber",
    "database": "pgx/v5"
  },
  "infrastructure": {
    "container": "Docker",
    "orchestration": "Docker Compose (dev), ECS (prod)",
    "storage": "S3/R2",
    "queue": "Redis + BullMQ"
  }
}
```

#### 1.3 Initial Setup Commands
```bash
# Initialize monorepo
pnpm init
npm install -g turbo
cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    }
  }
}
EOF

# Setup workspace
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - apps/*
  - packages/*
EOF

# Create web app (Next.js)
cd apps
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir
cd web
pnpm add @radix-ui/react-dialog @radix-ui/react-progress lucide-react

# Create worker (Go)
cd ../
mkdir worker
cd worker
go mod init github.com/yourusername/multiboard-sync-service/worker
go get github.com/gofiber/fiber/v2
go get github.com/jackc/pgx/v5
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/s3
```

### Phase 2: Core Sync Logic (Week 2)

#### 2.1 Database Operations Package
```go
// packages/db-sync/export.go
package dbsync

import (
    "context"
    "fmt"
    "io"
    "github.com/jackc/pgx/v5/pgxpool"
)

type ExportOptions struct {
    SourceDSN      string
    Tables         []string
    ExcludeTables  []string
    ChunkSize      int
    Compression    bool
}

type Exporter struct {
    pool *pgxpool.Pool
    opts ExportOptions
}

func NewExporter(opts ExportOptions) (*Exporter, error) {
    config, err := pgxpool.ParseConfig(opts.SourceDSN)
    if err != nil {
        return nil, err
    }
    
    pool, err := pgxpool.NewWithConfig(context.Background(), config)
    if err != nil {
        return nil, err
    }
    
    return &Exporter{pool: pool, opts: opts}, nil
}

func (e *Exporter) Export(writer io.Writer) error {
    // Implementation for streaming SQL export
    // 1. Get table list respecting dependencies
    // 2. For each table:
    //    - Write TRUNCATE statement
    //    - Stream data in chunks
    //    - Write as INSERT statements
    // 3. Handle large objects separately
    return nil
}
```

#### 2.2 Import Service
```go
// packages/db-sync/import.go
package dbsync

type ImportOptions struct {
    TargetDSN     string
    BackupFirst   bool
    ValidateSchema bool
    DryRun        bool
}

type Importer struct {
    pool *pgxpool.Pool
    opts ImportOptions
}

func (i *Importer) Import(reader io.Reader, progress chan<- Progress) error {
    // Implementation for streaming SQL import
    // 1. Create backup if requested
    // 2. Validate schema compatibility
    // 3. Parse SQL statements
    // 4. Execute in transactions
    // 5. Report progress
    return nil
}
```

### Phase 3: API Development (Week 2-3)

#### 3.1 REST API Endpoints
```go
// apps/worker/main.go
package main

import (
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/websocket/v2"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100MB
    })

    // API Routes
    api := app.Group("/api")
    
    // Database operations
    api.Post("/databases/test", testConnection)
    api.Get("/databases", listDatabases)
    
    // Sync jobs
    api.Post("/sync/export", createExportJob)
    api.Post("/sync/import", createImportJob)
    api.Get("/sync/jobs/:id", getJobStatus)
    api.Delete("/sync/jobs/:id", cancelJob)
    
    // WebSocket for real-time updates
    app.Use("/ws", websocket.New(websocket.Config{
        ReadBufferSize:  1024,
        WriteBufferSize: 1024,
    }))
    app.Get("/ws/:jobId", websocket.New(handleWebSocket))
    
    app.Listen(":8080")
}
```

#### 3.2 Job Queue Implementation
```go
// apps/worker/queue/queue.go
package queue

import (
    "context"
    "encoding/json"
    "github.com/redis/go-redis/v9"
)

type JobType string

const (
    JobTypeExport JobType = "export"
    JobTypeImport JobType = "import"
)

type Job struct {
    ID       string                 `json:"id"`
    Type     JobType               `json:"type"`
    Config   map[string]interface{} `json:"config"`
    Status   string                `json:"status"`
    Progress int                   `json:"progress"`
}

type Queue struct {
    redis *redis.Client
}

func (q *Queue) Enqueue(job Job) error {
    data, _ := json.Marshal(job)
    return q.redis.LPush(context.Background(), "sync:jobs", data).Err()
}

func (q *Queue) Process(handler func(Job) error) {
    // Worker loop to process jobs
}
```

### Phase 4: Storage Layer (Week 3)

#### 4.1 S3 Storage Implementation
```go
// packages/storage/s3.go
package storage

import (
    "context"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3Storage struct {
    client *s3.Client
    bucket string
}

func NewS3Storage(bucket string) (*S3Storage, error) {
    cfg, err := config.LoadDefaultConfig(context.TODO())
    if err != nil {
        return nil, err
    }
    
    return &S3Storage{
        client: s3.NewFromConfig(cfg),
        bucket: bucket,
    }, nil
}

func (s *S3Storage) Upload(key string, data io.Reader) (string, error) {
    // Upload with multipart for large files
    return "", nil
}

func (s *S3Storage) GeneratePresignedURL(key string) (string, error) {
    // Generate temporary download URL
    return "", nil
}
```

### Phase 5: UI Application (Week 3-4)

#### 5.1 Next.js UI Structure
```typescript
// apps/web/app/page.tsx
export default function Dashboard() {
  return (
    <div className="container mx-auto p-6">
      <h1>Database Sync Service</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SyncWizard />
        <RecentJobs />
      </div>
    </div>
  )
}

// apps/web/app/sync/new/page.tsx
export default function NewSync() {
  // Multi-step wizard:
  // 1. Select source database
  // 2. Select target database
  // 3. Configure options
  // 4. Review and start
}

// apps/web/app/jobs/[id]/page.tsx
export default function JobDetail({ params }) {
  // Real-time progress display
  // WebSocket connection for updates
  // Cancel/retry options
}
```

#### 5.2 Real-time Progress Component
```typescript
// apps/web/components/JobProgress.tsx
'use client';

import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';

export function JobProgress({ jobId }: { jobId: string }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/ws/${jobId}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress(data.progress);
      setStatus(data.status);
    };
    
    return () => ws.close();
  }, [jobId]);
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{status}</span>
        <span>{progress}%</span>
      </div>
      <Progress value={progress} />
    </div>
  );
}
```

### Phase 6: Deployment (Week 4)

#### 6.1 Docker Configuration
```dockerfile
# apps/worker/Dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o sync-worker

FROM alpine:latest
RUN apk --no-cache add ca-certificates postgresql-client
WORKDIR /root/
COPY --from=builder /app/sync-worker .
EXPOSE 8080
CMD ["./sync-worker"]
```

#### 6.2 Docker Compose for Development
```yaml
# docker-compose.yml
version: '3.8'

services:
  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8080
    depends_on:
      - worker

  worker:
    build: ./apps/worker
    ports:
      - "8080:8080"
    environment:
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT=http://minio:9000
      - S3_BUCKET=sync-dumps
      - AWS_ACCESS_KEY_ID=minioadmin
      - AWS_SECRET_ACCESS_KEY=minioadmin
    depends_on:
      - redis
      - minio
      - postgres
    volumes:
      - ./dumps:/app/dumps

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data

  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=testdb
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  redis-data:
  minio-data:
  postgres-data:
```

#### 6.3 Railway Deployment Configuration
```yaml
# railway.toml
[build]
builder = "dockerfile"
dockerfilePath = "./apps/worker/Dockerfile"

[deploy]
startCommand = "./sync-worker"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on-failure"
restartPolicyMaxRetries = 3

[[services]]
name = "sync-worker"
port = 8080

[[services]]
name = "sync-web"
buildCommand = "cd apps/web && pnpm build"
startCommand = "cd apps/web && pnpm start"
port = 3000
```

### Phase 7: Production Infrastructure (Week 5)

#### 7.1 AWS Terraform Configuration
```hcl
# infrastructure/terraform/main.tf
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "multiboard-terraform-state"
    key    = "sync-service/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC Configuration
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  
  name = "sync-service-vpc"
  cidr = "10.0.0.0/16"
  
  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]
  
  enable_nat_gateway = true
  enable_vpn_gateway = false
}

# ECS Cluster
resource "aws_ecs_cluster" "sync_cluster" {
  name = "sync-service-cluster"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ECR Repository
resource "aws_ecr_repository" "sync_worker" {
  name = "sync-worker"
  
  image_scanning_configuration {
    scan_on_push = true
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "sync_worker" {
  family                   = "sync-worker"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = "2048"
  memory                  = "4096"
  execution_role_arn      = aws_iam_role.ecs_execution_role.arn
  task_role_arn          = aws_iam_role.ecs_task_role.arn
  
  container_definitions = jsonencode([{
    name  = "sync-worker"
    image = "${aws_ecr_repository.sync_worker.repository_url}:latest"
    
    environment = [
      {
        name  = "REDIS_URL"
        value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
      },
      {
        name  = "S3_BUCKET"
        value = aws_s3_bucket.sync_dumps.id
      }
    ]
    
    secrets = [
      {
        name      = "DATABASE_CREDENTIALS"
        valueFrom = aws_secretsmanager_secret.db_credentials.arn
      }
    ]
    
    portMappings = [{
      containerPort = 8080
    }]
    
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.sync_worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

# ALB for ECS Service
resource "aws_lb" "sync_alb" {
  name               = "sync-service-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = module.vpc.public_subnets
}

# S3 Bucket for Dumps
resource "aws_s3_bucket" "sync_dumps" {
  bucket = "multiboard-sync-dumps-${var.environment}"
}

resource "aws_s3_bucket_lifecycle_configuration" "sync_dumps_lifecycle" {
  bucket = aws_s3_bucket.sync_dumps.id
  
  rule {
    id     = "expire-old-dumps"
    status = "Enabled"
    
    expiration {
      days = 30
    }
  }
}

# ElastiCache Redis
resource "aws_elasticache_subnet_group" "redis" {
  name       = "sync-redis-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "sync-redis"
  engine              = "redis"
  node_type           = "cache.t3.micro"
  num_cache_nodes     = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]
}

# Secrets Manager for Credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name = "sync-service-db-credentials"
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    production_url = var.production_database_url
    staging_url    = var.staging_database_url
    dev_url        = var.dev_database_url
  })
}
```

#### 7.2 GitHub Actions CI/CD
```yaml
# .github/workflows/deploy.yml
name: Deploy Sync Service

on:
  push:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: sync-worker

jobs:
  deploy-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1
      
      - name: Build and push Docker image
        working-directory: ./apps/worker
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
      
      - name: Update ECS service
        run: |
          aws ecs update-service \
            --cluster sync-service-cluster \
            --service sync-worker \
            --force-new-deployment

  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./apps/web
```

---

## Migration Strategy

### Phase 1: Parallel Operation (Week 6)
1. Deploy new sync service to staging
2. Keep existing sync in admin app
3. Add feature flag to toggle between old/new

### Phase 2: Gradual Rollout (Week 7)
1. Enable for internal team
2. Monitor performance and errors
3. Enable for 10% of users
4. Gradually increase to 100%

### Phase 3: Deprecation (Week 8)
1. Remove old sync code from admin app
2. Update documentation
3. Archive old code

---

## Security Considerations

### Credential Management
```yaml
Production:
  - Use AWS Secrets Manager for database URLs
  - Rotate credentials monthly
  - Audit access logs

Development:
  - Use .env files (never commit)
  - Separate credentials per developer
  - Use read-only credentials when possible
```

### Network Security
```yaml
VPC Configuration:
  - Private subnets for ECS tasks
  - Public subnet only for ALB
  - Security groups with minimal ports
  - VPC endpoints for S3 access

Database Access:
  - SSL/TLS required
  - IP whitelist for production
  - Separate read/write credentials
```

### Data Protection
```yaml
At Rest:
  - S3 encryption enabled
  - Database encryption
  - Encrypted EBS volumes

In Transit:
  - HTTPS only
  - Database SSL
  - VPN for admin access
```

---

## Cost Analysis

### Monthly Cost Breakdown

#### AWS Option
```
ECS Fargate (2 vCPU, 4GB RAM): $50
S3 Storage (500GB + transfer): $15
ElastiCache Redis (t3.micro): $13
ALB: $20
CloudWatch: $5
Secrets Manager: $2
------------------------
Total: ~$105/month
```

#### Railway Option
```
Worker (8GB RAM): $40
Redis: $10
Storage: $5
------------------------
Total: ~$55/month
```

#### Cost Optimization Tips
1. Use spot instances for non-critical jobs
2. Implement auto-scaling based on queue depth
3. Compress dumps (70-90% size reduction)
4. Use S3 lifecycle policies
5. Schedule heavy operations during off-peak

---

## Performance Targets

### Key Metrics
```yaml
Export Performance:
  - 1GB database: < 1 minute
  - 10GB database: < 10 minutes
  - 100GB database: < 60 minutes

Import Performance:
  - 1GB dump: < 2 minutes
  - 10GB dump: < 15 minutes
  - 100GB dump: < 90 minutes

Reliability:
  - 99.9% success rate
  - Automatic retry on failure
  - Zero data loss

Scalability:
  - Handle 100 concurrent jobs
  - Support databases up to 1TB
  - Auto-scale based on load
```

---

## Monitoring & Alerts

### Metrics to Track
```yaml
Application Metrics:
  - Job success/failure rate
  - Average job duration
  - Queue depth
  - Data transfer rates

Infrastructure Metrics:
  - CPU/Memory usage
  - Disk I/O
  - Network throughput
  - S3 storage usage

Business Metrics:
  - Jobs per day
  - Most synced databases
  - User engagement
  - Cost per job
```

### Alert Configuration
```yaml
Critical Alerts:
  - Job failure rate > 10%
  - Queue depth > 100
  - Memory usage > 90%
  - Disk space < 10%

Warning Alerts:
  - Job duration > 2x average
  - Error rate > 5%
  - CPU usage > 80%
```

---

## Development Guidelines

### Code Structure
```
packages/db-sync/
├── src/
│   ├── export/
│   │   ├── exporter.go
│   │   ├── schema.go
│   │   └── progress.go
│   ├── import/
│   │   ├── importer.go
│   │   ├── validator.go
│   │   └── backup.go
│   └── common/
│       ├── database.go
│       ├── storage.go
│       └── compression.go
└── tests/
```

### Testing Strategy
```yaml
Unit Tests:
  - Core sync logic
  - Schema validation
  - Progress tracking
  Coverage: > 80%

Integration Tests:
  - Database operations
  - S3 uploads/downloads
  - Queue processing
  Coverage: > 60%

E2E Tests:
  - Complete sync flow
  - Error scenarios
  - Large dataset handling
  Coverage: Key paths

Load Tests:
  - 10GB+ databases
  - Concurrent jobs
  - Memory limits
```

---

## Troubleshooting Guide

### Common Issues

#### 1. Export Timeout
```
Symptom: Export fails after 10 minutes
Cause: Database query timeout
Solution:
  - Increase statement_timeout
  - Use smaller chunk size
  - Add indexes to large tables
```

#### 2. Import Memory Error
```
Symptom: OOM during import
Cause: Loading entire dump in memory
Solution:
  - Enable streaming mode
  - Reduce batch size
  - Increase container memory
```

#### 3. Schema Mismatch
```
Symptom: Import fails with constraint errors
Cause: Different database versions
Solution:
  - Run schema validation first
  - Update target schema
  - Use compatible mode
```

---

## Support & Maintenance

### Regular Maintenance Tasks
```yaml
Daily:
  - Check job failure alerts
  - Monitor queue depth
  - Review error logs

Weekly:
  - Clean old dumps from S3
  - Review performance metrics
  - Update documentation

Monthly:
  - Rotate credentials
  - Update dependencies
  - Performance optimization
  - Cost review
```

### Incident Response
```yaml
Severity Levels:
  P1: Complete service down
  P2: > 50% jobs failing
  P3: Performance degradation
  P4: Minor issues

Response Times:
  P1: 15 minutes
  P2: 1 hour
  P3: 4 hours
  P4: Next business day
```

---

## Appendix A: SQL Dump Format

### Example SQL Output
```sql
-- Multiboard Sync Service SQL Dump
-- Version: 1.0.0
-- Source: production
-- Date: 2024-01-15 10:30:00 UTC
-- Tables: 25
-- Records: 1,234,567

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;

-- Disable triggers
SET session_replication_role = 'replica';

BEGIN;

-- Table: Categories
TRUNCATE TABLE "Categories" CASCADE;
COPY "Categories" (id, name, slug, description, image, "createdAt", "updatedAt") FROM stdin;
1	Electronics	electronics	Electronic components	https://...	2024-01-01	2024-01-01
2	Mechanical	mechanical	Mechanical parts	https://...	2024-01-01	2024-01-01
\.

-- Table: Component
TRUNCATE TABLE "Component" CASCADE;
COPY "Component" (id, name, slug, description, image, "createdAt", "updatedAt") FROM stdin;
1	Resistor	resistor	Basic resistor	https://...	2024-01-01	2024-01-01
\.

-- Continue for all tables...

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Update sequences
SELECT setval('"Categories_id_seq"', (SELECT MAX(id) FROM "Categories"));
SELECT setval('"Component_id_seq"', (SELECT MAX(id) FROM "Component"));

-- Analyze tables for query planner
ANALYZE;

COMMIT;

-- End of dump
```

---

## Appendix B: API Documentation

### REST Endpoints

#### Create Export Job
```http
POST /api/sync/export
Content-Type: application/json
Authorization: Bearer {api_key}

{
  "source": "production",
  "tables": ["Component", "Part"],
  "format": "sql",
  "compression": true
}

Response:
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "estimatedDuration": 300
}
```

#### Get Job Status
```http
GET /api/sync/jobs/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer {api_key}

Response:
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "type": "export",
  "status": "running",
  "progress": 45,
  "startedAt": "2024-01-15T10:30:00Z",
  "metadata": {
    "tablesProcessed": 5,
    "totalTables": 11,
    "recordsProcessed": 123456,
    "currentTable": "Part"
  }
}
```

#### WebSocket Progress Stream
```javascript
const ws = new WebSocket('wss://sync.multiboard.com/ws/550e8400-e29b-41d4-a716-446655440000');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Progress: ${data.progress}%`);
  console.log(`Status: ${data.status}`);
  console.log(`Current: ${data.currentTable}`);
};
```

---

## Appendix C: Database Credentials

**⚠️ NEVER COMMIT THESE TO GIT**

See `SYNC_SERVICE_CONFIG.env.example` for the complete list of required credentials.

---

## Contact & Support

### Development Team
- Lead Developer: [Your Name]
- DevOps: [DevOps Contact]
- Database Admin: [DBA Contact]

### External Resources
- AWS Support: [AWS Account ID]
- Railway Support: [Railway Team ID]
- Monitoring: [Datadog/NewRelic Link]

---

END OF DOCUMENT