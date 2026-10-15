import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';

import {
  RedlockManager,
  InMemoryInventoryRepository,
  InventoryService,
  createInventoryApp,
  ConcurrencyError,
} from '../services/inventory-service/src/index';
import { TokenService } from '../services/auth-service/src/index';
import { FlightSeat } from '@airline/types';

describe('Phase 4 Inventory & The Concurrency Core - Comprehensive Pass Checks', () => {
  let server: http.Server;
  let baseUrl: string;
  let tokenService: TokenService;
  let repo: InMemoryInventoryRepository;
  let redlock: RedlockManager;
  let inventoryService: InventoryService;

  const testFlightId = 'flt-concurrency-phase4-001';
  const testSeatId = 'seat-concurrency-phase4-001';

  before(async () => {
    tokenService = new TokenService({
      jwtSecret: 'test-secret-inventory-phase4',
      expiresIn: '2h',
    });

    repo = new InMemoryInventoryRepository();
    redlock = new RedlockManager({ defaultTtlMs: 5000 });
    inventoryService = new InventoryService(repo, redlock, { defaultHoldDurationSeconds: 600 });

    // Seed test seats
    const initialSeats: FlightSeat[] = [
      {
        id: testSeatId,
        flightId: testFlightId,
        seatNumber: '01A',
        seatClass: 'FIRST',
        price: 50000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'seat-concurrency-phase4-002',
        flightId: testFlightId,
        seatNumber: '01B',
        seatClass: 'FIRST',
        price: 50000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'seat-concurrency-phase4-003',
        flightId: testFlightId,
        seatNumber: '10A',
        seatClass: 'ECONOMY',
        price: 15000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    await repo.saveSeats(initialSeats);

    const appSetup = createInventoryApp({
      repo,
      redlock,
      tokenService,
      inventoryService,
    });

    await new Promise<void>((resolve) => {
      server = appSetup.app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) server.close();
    if (redlock) await redlock.close();
    if (tokenService) await tokenService.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Redlock Distributed Lock Mechanics
  // ---------------------------------------------------------------------------
  describe('1. Redlock Distributed Lock Mechanism', () => {
    it('should acquire lock with unique token and TTL', async () => {
      const lock = await redlock.acquire('test:lock:1', 2000);
      assert.ok(lock);
      assert.strictEqual(lock.resource, 'test:lock:1');
      assert.ok(lock.token);
      assert.strictEqual(await redlock.isLocked('test:lock:1'), true);

      // Concurrent acquire must fail
      const concurrent = await redlock.acquire('test:lock:1', 2000);
      assert.strictEqual(concurrent, null);

      // Release
      const released = await lock.release();
      assert.strictEqual(released, true);
      assert.strictEqual(await redlock.isLocked('test:lock:1'), false);
    });

    it('should reject lock release when token does not match', async () => {
      const lock = await redlock.acquire('test:lock:2', 2000);
      assert.ok(lock);

      // Attempt release with fake token
      const fakeRelease = await redlock.releaseLock('test:lock:2', 'fake-uuid-token');
      assert.strictEqual(fakeRelease, false);

      // Resource must remain locked
      assert.strictEqual(await redlock.isLocked('test:lock:2'), true);

      // Release with correct token
      await lock.release();
      assert.strictEqual(await redlock.isLocked('test:lock:2'), false);
    });

    it('should automatically expire lock after TTL', async () => {
      const shortTtlMs = 100;
      const lock = await redlock.acquire('test:lock:3', shortTtlMs);
      assert.ok(lock);

      // Wait for TTL expiration
      await new Promise((r) => setTimeout(r, 150));

      assert.strictEqual(await redlock.isLocked('test:lock:3'), false);
      const reacquired = await redlock.acquire('test:lock:3', 1000);
      assert.ok(reacquired);
      await reacquired.release();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Optimistic Concurrency Control (OCC) Core
  // ---------------------------------------------------------------------------
  describe('2. Optimistic Concurrency Control (OCC) Core', () => {
    it('should succeed when version matches and increment version', async () => {
      const occSeatId = 'seat-concurrency-phase4-002';
      const seatBefore = await repo.getSeatById(occSeatId);
      assert.ok(seatBefore);
      assert.strictEqual(seatBefore.version, 1);

      const res = await repo.updateSeatWithOCC(occSeatId, 1, {
        status: 'HELD',
        heldByUserId: 'usr-occ-1',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.seat?.version, 2);
      assert.strictEqual(res.seat?.status, 'HELD');
    });

    it('should reject update with conflict when version does not match', async () => {
      const occSeatId = 'seat-concurrency-phase4-002';
      // Current version is now 2
      const res = await repo.updateSeatWithOCC(occSeatId, 1, {
        status: 'BOOKED',
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.conflict, true);
      assert.ok(res.errorMessage?.includes('OCC Conflict'));

      // Clean up back to AVAILABLE
      await repo.updateSeatWithOCC(occSeatId, 2, {
        status: 'AVAILABLE',
        heldByUserId: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. 3-Tiered Seat Holding Mechanism
  // ---------------------------------------------------------------------------
  describe('3. 3-Tiered Seat Holding Mechanism', () => {
    it('should hold an available seat with 3-tiered lock protection', async () => {
      const seatId = 'seat-concurrency-phase4-003';
      const userId = 'usr-hold-test-1';

      const result = await inventoryService.holdSeat(seatId, userId, 600);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.lockType, '3-TIERED (REDLOCK + OCC + ROW_LOCK)');
      assert.strictEqual(result.seat.status, 'HELD');
      assert.strictEqual(result.seat.heldByUserId, userId);
      assert.ok(result.heldUntil instanceof Date);

      // Release for subsequent tests
      await inventoryService.releaseSeat(seatId, userId);
    });

    it('should reject hold when seat is already held by another user', async () => {
      const seatId = 'seat-concurrency-phase4-003';
      await inventoryService.holdSeat(seatId, 'user-A', 600);

      await assert.rejects(
        async () => {
          await inventoryService.holdSeat(seatId, 'user-B', 600);
        },
        (err: any) => {
          assert.ok(err instanceof ConcurrencyError);
          assert.strictEqual(err.code, 'SEAT_NOT_AVAILABLE');
          return true;
        }
      );

      // Clean up
      await inventoryService.releaseSeat(seatId, 'user-A');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. High-Concurrency Stress Test (500 Parallel Requests on Single Seat)
  // ---------------------------------------------------------------------------
  describe('4. High-Concurrency Stress Test (500 Parallel Requests on Single Seat)', () => {
    it('should guarantee exactly 1 winner and 499 conflicts among 500 concurrent requests', async () => {
      const concurrentSeatId = testSeatId;
      const initialSeat = await repo.getSeatById(concurrentSeatId);
      assert.ok(initialSeat);
      assert.strictEqual(initialSeat.status, 'AVAILABLE');
      assert.strictEqual(initialSeat.version, 1);

      const requestCount = 500;
      const promises: Promise<{ success: boolean; userId: string; error?: any }>[] = [];

      for (let i = 0; i < requestCount; i++) {
        const userId = `concurrent-user-${i}`;
        promises.push(
          inventoryService
            .holdSeat(concurrentSeatId, userId, 300)
            .then(() => ({ success: true, userId }))
            .catch((err) => ({ success: false, userId, error: err }))
        );
      }

      // Execute all 500 parallel requests simultaneously
      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      assert.strictEqual(
        successes.length,
        1,
        `Expected EXACTLY 1 winner among 500 concurrent requests, but got ${successes.length}`
      );
      assert.strictEqual(
        failures.length,
        499,
        `Expected EXACTLY 499 rejected requests, but got ${failures.length}`
      );

      // Verify each failure is a proper ConcurrencyError (LOCKED, OCC_CONFLICT, or SEAT_NOT_AVAILABLE)
      for (const fail of failures) {
        assert.ok(
          fail.error instanceof ConcurrencyError,
          `Failure must be a ConcurrencyError, got ${fail.error}`
        );
        assert.ok(
          ['LOCKED', 'OCC_CONFLICT', 'SEAT_NOT_AVAILABLE'].includes(fail.error.code),
          `Error code must be a valid concurrency code, got ${fail.error.code}`
        );
      }

      // Verify the final seat state in repository
      const finalSeat = await repo.getSeatById(concurrentSeatId);
      assert.ok(finalSeat);
      assert.strictEqual(finalSeat.status, 'HELD');
      assert.strictEqual(finalSeat.heldByUserId, successes[0].userId);
      assert.strictEqual(finalSeat.version, 2, 'OCC version must be incremented exactly once to 2');

      // Clean up hold
      await inventoryService.releaseSeat(concurrentSeatId, successes[0].userId);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Seat Release & Seat Confirm Lifecycle
  // ---------------------------------------------------------------------------
  describe('5. Seat Release & Confirm Lifecycle', () => {
    it('should allow holding user to confirm seat to BOOKED status', async () => {
      const seatId = 'seat-concurrency-phase4-003';
      const userId = 'usr-booking-flow-1';
      const bookingId = 'bk-pnr-9988';

      // 1. Hold seat
      await inventoryService.holdSeat(seatId, userId, 600);

      // 2. Confirm seat
      const confirmResult = await inventoryService.confirmSeat(seatId, userId, bookingId);
      assert.strictEqual(confirmResult.success, true);
      assert.strictEqual(confirmResult.seat.status, 'BOOKED');
      assert.strictEqual(confirmResult.seat.heldUntil, null);

      // 3. Confirming a booked seat cannot be re-held
      await assert.rejects(
        async () => {
          await inventoryService.holdSeat(seatId, 'another-user', 600);
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SEAT_NOT_AVAILABLE');
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Inventory Service HTTP API Endpoints
  // ---------------------------------------------------------------------------
  describe('6. Inventory Service HTTP API Endpoints', () => {
    it('GET /api/inventory/flights/:flightId/seats should return seat inventory', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/flights/${testFlightId}/seats`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.flightId, testFlightId);
      assert.ok(body.count >= 3);
      assert.ok(Array.isArray(body.data));
    });

    it('GET /api/inventory/seats/:seatId should return individual seat', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/seats/${testSeatId}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.data.id, testSeatId);
      assert.strictEqual(body.data.seatNumber, '01A');
    });

    it('POST /api/inventory/seats/:seatId/hold should hold seat via HTTP', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/seats/${testSeatId}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'http-user-1',
          holdDurationSeconds: 300,
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.message, 'Seat held successfully');
      assert.strictEqual(body.data.seat.status, 'HELD');
      assert.strictEqual(body.data.seat.heldByUserId, 'http-user-1');
      assert.strictEqual(body.event.topic, 'airline.inventory.seat.held');
    });

    it('POST /api/inventory/seats/:seatId/hold should return 409 Conflict when already held', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/seats/${testSeatId}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'http-user-2',
        }),
      });

      assert.strictEqual(res.status, 409);
      const body = (await res.json()) as any;
      assert.strictEqual(body.error, 'Conflict');
    });

    it('POST /api/inventory/seats/:seatId/release should release seat hold via HTTP', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/seats/${testSeatId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'http-user-1',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.message, 'Seat hold released successfully');
      assert.strictEqual(body.data.seat.status, 'AVAILABLE');
      assert.strictEqual(body.event.topic, 'airline.inventory.seat.released');
    });
  });
});
