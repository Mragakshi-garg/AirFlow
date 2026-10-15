# Airline Reservation & Flight Management Platform

## 🛠 Tech Stack

### 1. Application Layer
- **Backend Framework**: **Node.js** with **Express**.
- **Language**: **TypeScript** (Strict mode) for type safety across services.
- **Monorepo Management**: **pnpm workspaces** + **Turborepo** for fast, optimized builds and shared code sharing (types, DTOs, configs).

### 2. Data & State Management
- **Primary Database**: **PostgreSQL** (Primary/Replica setup) with **Drizzle ORM** for performant, type-safe SQL query generation and row-level locking (`SELECT ... FOR UPDATE`).
- **Caching & Distributed Locks**: **Redis** for cache-aside patterns, token revocation, rate-limiting, and Redlock distributed locks.
- **Search Engine**: **Elasticsearch** for high-performance, facet-based, and text-based flight search queries.

### 3. Messaging & Background Processing
- **Event Broker**: **Kafka** (using `kafkajs`). Backbone for asynchronous inter-service communication (Saga pattern, async indexing, notifications).
- **Background Jobs**: **BullMQ** (backed by Redis) for delayed tasks and cron jobs (e.g., releasing held seats, sending scheduled reminders).

### 4. Infrastructure & DevOps
- **Containerization**: **Docker** + **Docker Compose** for local development.
- **Load Balancing**: **Nginx** acting as the API Gateway and reverse proxy.
- **Deployment**: Kubernetes manifests (Deployments, Services, HPA).

### 5. Observability & Resilience
- **Logging**: **Pino** (structured JSON logging) with correlation IDs.
- **Tracing & Metrics**: **OpenTelemetry** for distributed tracing exporting to **Jaeger**. **Prometheus** for metrics scraping, visualized via **Grafana**.
- **Resilience**: Circuit breakers, rate limiters, and jittered retries.

---

## 🏗 Incremental Implementation Plan

- [x] **Phase 1: Foundation, Infra & Monorepo Setup** (COMPLETED & VERIFIED)
  - Initialize pnpm monorepo and Turborepo.
  - Set up shared libraries (`@airline/types`, `@airline/events`, `@airline/logger`, `@airline/db`).
  - Create comprehensive `docker-compose.yml` (PostgreSQL, Redis, Kafka, Zookeeper, Elasticsearch, Jaeger, Prometheus, Grafana).
  - Define initial Drizzle schema and base migrations.
- [x] **Phase 2: Database Schema & Seed Script** (COMPLETED & VERIFIED)
  - Finalize schema: `users`, `airlines`, `airports`, `aircrafts`, `flights`, `flight_seats`, `bookings`, `payments`, `outbox_events`, `idempotency_keys`.
  - Implement declarative PostgreSQL range partitioning for `flights` and `bookings`.
  - Robust TypeScript seeder (1000+ flights, seats, airlines, airports, aircrafts, test users).
  - Automated pass check suite (All 17 tests passing across Phase 1 & 2).
- [x] **Phase 3: Auth & Admin Service** (COMPLETED & VERIFIED)
  - Auth Service: JWT issue/verify, Redis token revocation list, RBAC middleware.
  - Admin Service: CRUD for airlines, flights, and seat inventory generation.
  - API Gateway (Nginx) reverse proxy routing config in infrastructure/nginx/nginx.conf.
  - Automated pass check suite (All 34 tests passing across Phase 1, 2 & 3).
- [x] **Phase 4: Inventory & The Concurrency Core (Critical)** (COMPLETED & VERIFIED)
  - Seat holding mechanism with configurable TTL, auto-expiration and lifecycle states (AVAILABLE -> HELD -> BOOKED).
  - 3-Tiered Concurrency Protection: Redlock (Tier 1) -> OCC with version checking (Tier 2) -> Pessimistic Row-Level Lock (`SELECT ... FOR UPDATE` / row mutex) (Tier 3).
  - Inventory Service HTTP API (`/api/inventory/flights/:id/seats`, `/api/inventory/seats/:id/hold`, `/api/inventory/seats/:id/release`, `/api/inventory/seats/:id/confirm`).
  - High-concurrency stress test: 500 parallel requests on single seat asserting exactly 1 winner and 499 conflicts.
  - Automated pass check suite (All 48 tests passing across Phases 1, 2, 3 & 4).
- [x] **Phase 5: Flight Search & Caching** (COMPLETED & VERIFIED)
  - Search Service: Synchronize PostgreSQL flights to Elasticsearch/Search Index via Kafka events.
  - Search API with Redis cache-aside (Singleflight request coalescing + Jittered TTL).
  - Faceted search aggregations (airlines, min/max/avg price range) and multi-field routing.
  - High-concurrency Singleflight stress test: 50 parallel requests coalescing onto exactly 1 underlying execution.
  - Automated pass check suite (All 64 tests passing across Phases 1, 2, 3, 4 & 5).
- [ ] **Phase 6: Booking, Payment & Transactional Outbox (Saga)** (NEXT)
  - Booking Service & Payment Service (Mock).
  - Transactional Outbox Pattern (`outbox_events` table + Kafka relay).
  - Saga Orchestrator: `BookingCreated` -> `PaymentPending` -> `PaymentSuccess/Failed` -> `ConfirmBooking/ReleaseSeat`.
  - Idempotency with `Idempotency-Key`.
- [ ] **Phase 7: Background Jobs (BullMQ) & Seat Hold Flow**
  - Seat hold expiry: 600s TTL BullMQ delayed job auto-releasing seat.
  - Periodic Sweeper jobs.
- [ ] **Phase 8: Event Architecture & Notifications**
  - Kafka consumers with Consumer Groups and DLQ.
  - Notification Service: `FlightBooked`, `PaymentCompleted`, `FlightDelayed`.
- [ ] **Phase 9: Observability & Resilience**
  - OpenTelemetry + Prometheus + Grafana dashboards.
  - Redis token bucket rate limiting + Circuit breakers.
- [ ] **Phase 10: Testing, Load Testing & Documentation**
  - Integration tests with Testcontainers.
  - k6 load tests (search at 1k+ RPS, booking spikes).
  - Architecture diagrams & OpenAPI docs.
