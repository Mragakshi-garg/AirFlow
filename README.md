# 🛫 Airline Reservation & Flight Management Platform

> A high-throughput, distributed event-driven airline reservation and flight management platform built with Node.js, TypeScript, PostgreSQL, Drizzle ORM, Redis, Kafka, Elasticsearch, and Turborepo.

---

## 🛠 Tech Stack

- **Monorepo**: pnpm Workspaces + Turborepo
- **Language & Runtime**: Node.js v20+ / TypeScript (Strict Mode)
- **Primary Database**: PostgreSQL 16 with Drizzle ORM & Range Partitioning
- **Distributed Cache & Locks**: Redis 7 (Cache-aside, Token Revocation, Redlock)
- **Message Broker**: Apache Kafka (confluentinc/cp-kafka)
- **Search Engine**: Elasticsearch 8.11 (Faceted flight queries)
- **API Gateway**: Nginx Reverse Proxy (Port 80)
- **Observability**: Pino structured JSON logger, OpenTelemetry, Jaeger, Prometheus & Grafana

---

## 🏗 Architecture & Workspace Packages

```
├── packages/
│   ├── types/          # Shared domain entities, DTOs & status enums
│   ├── events/         # Kafka topic definitions, Saga envelopes & event schemas
│   ├── logger/         # Pino structured JSON logging with correlation IDs
│   └── db/             # Drizzle schema, connection pool & 1000+ flight seeder
├── services/
│   ├── auth-service/      # JWT authentication, Redis token revocation list & RBAC
│   ├── admin-service/     # Airline CRUD, flight operations & inventory generation
│   └── inventory-service/ # Seat hold core, 3-tiered lock & high-concurrency engine
├── infrastructure/
│   ├── nginx/             # API Gateway reverse proxy configuration
│   └── prometheus/        # Metrics scraping definitions
├── tests/
│   ├── phase1.test.ts     # Monorepo foundation & shared libraries verification
│   ├── phase2.test.ts     # Database schema, partitioning & seeder verification
│   ├── phase3.test.ts     # Auth, Redis blacklist, RBAC & admin endpoints verification
│   └── phase4.test.ts     # Inventory hold, 3-tiered lock & 500-request concurrency verification
└── docker-compose.yml     # Complete local infrastructure stack
```

---

## 🚦 Implementation Status

- [x] **Phase 1: Foundation, Infra & Monorepo Setup** (Verified — 8 tests passing)
- [x] **Phase 2: Database Schema & Seed Script** (Verified — 1000+ flights seeder & partitioning)
- [x] **Phase 3: Auth & Admin Service** (Verified — JWT, Redis blacklist, RBAC, Admin CRUD, Nginx Gateway)
- [x] **Phase 4: Inventory & The Concurrency Core** (Verified — Redlock + OCC + Row-level lock, 500-request parallel test)
- [x] **Phase 5: Flight Search & Caching** (Verified — Elasticsearch sync + Redis cache-aside + Singleflight)
- [x] **Phase 6: Booking, Payment & Transactional Outbox (Saga)** (Verified — Saga Orchestrator, Outbox Relay, Idempotency)
- [ ] **Phase 7: Background Jobs (BullMQ) & Seat Hold Expiry**
- [ ] **Phase 8: Event Architecture & Notification Service**
- [ ] **Phase 9: Observability, Circuit Breakers & Rate Limiting**
- [ ] **Phase 10: Integration Testing & k6 Load Tests**

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v20 or higher
- **pnpm**: v9 or higher (`npx pnpm`)
- **Docker & Docker Compose**

### 2. Start Infrastructure
```bash
docker compose up -d
```

### 3. Install Dependencies & Build
```bash
npx pnpm install
npx pnpm build
```

### 4. Run Seed Script (Generates 1,000+ Flights)
```bash
npm run seed
```

### 5. Run Verification Test Suite
```bash
npm test
```
All 48 automated unit, concurrency & service tests will execute across all implemented phases.
