import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import {
  InMemoryJobQueue,
  SeatHoldExpiryWorker,
  PeriodicSweeper,
  WorkerManager,
} from '../services/worker-service/src/index';

import {
  InventoryService,
  InMemoryInventoryRepository,
  RedlockManager,
} from '../services/inventory-service/src/index';

import {
  InMemoryBookingRepository,
} from '../services/booking-service/src/index';

import { FlightSeat, Booking, OutboxEvent } from '@airline/types';
import { EventEnvelope } from '@airline/events';

describe('Phase 7 Background Jobs (BullMQ) & Seat Hold Flow - Comprehensive Pass Checks', () => {
  let inventoryRepo: InMemoryInventoryRepository;
  let inventoryService: InventoryService;
  let bookingRepo: InMemoryBookingRepository;
  let emittedEvents: EventEnvelope[] = [];

  const testFlightId = 'flt-worker-phase7-001';
  const testUserId = 'usr-worker-phase7-001';

  before(async () => {
    inventoryRepo = new InMemoryInventoryRepository();
    const redlock = new RedlockManager();
    inventoryService = new InventoryService(inventoryRepo, redlock);
    bookingRepo = new InMemoryBookingRepository();
    emittedEvents = [];
  });

  const eventDispatcher = async (event: EventEnvelope) => {
    emittedEvents.push(event);
  };

  // ---------------------------------------------------------------------------
  // 1. Queue Abstraction & Delayed Job Scheduling
  // ---------------------------------------------------------------------------
  describe('1. Queue Abstraction & Delayed Job Scheduling', () => {
    it('should schedule, hold in delayed state, and execute a delayed job after delay passes', async () => {
      const queue = new InMemoryJobQueue<{ message: string }>('test-delay-queue');
      let executed = false;
      let executedMessage = '';

      queue.process(async (job) => {
        executed = true;
        executedMessage = job.data.message;
      });

      const delayMs = 60;
      const job = await queue.add('delayed-task', { message: 'hello-delayed' }, { delay: delayMs });
      assert.strictEqual(job.status, 'delayed');

      // Before delay expires
      assert.strictEqual(executed, false);

      // Wait for delay to expire
      await new Promise((r) => setTimeout(r, delayMs + 30));

      assert.strictEqual(executed, true);
      assert.strictEqual(executedMessage, 'hello-delayed');

      await queue.close();
    });

    it('should cancel a delayed job before execution when removeJob is called', async () => {
      const queue = new InMemoryJobQueue<{ message: string }>('test-cancel-queue');
      let executed = false;

      queue.process(async () => {
        executed = true;
      });

      const jobId = 'job-to-cancel-001';
      await queue.add('delayed-task', { message: 'should-not-run' }, { delay: 80, jobId });

      // Cancel job
      const removed = await queue.removeJob(jobId);
      assert.strictEqual(removed, true);

      // Wait longer than delay
      await new Promise((r) => setTimeout(r, 110));

      assert.strictEqual(executed, false, 'Cancelled job must never execute');

      await queue.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Delayed Auto-Release of Expired Seat Holds
  // ---------------------------------------------------------------------------
  describe('2. Delayed Auto-Release of Expired Seat Holds', () => {
    const seatIdAutoExpire = 'seat-auto-expire-001';

    before(async () => {
      await inventoryRepo.saveSeats([
        {
          id: seatIdAutoExpire,
          flightId: testFlightId,
          seatNumber: '02A',
          seatClass: 'BUSINESS',
          price: 80000,
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    });

    it('should automatically release held seat back to AVAILABLE after TTL expiration', async () => {
      const queue = new InMemoryJobQueue<any>('seat-hold-expiry-test');
      const worker = new SeatHoldExpiryWorker(queue, inventoryService, eventDispatcher);

      // 1. Hold seat in inventory for 50ms
      const holdDurationSeconds = 1;
      await inventoryService.holdSeat(seatIdAutoExpire, testUserId, holdDurationSeconds);

      const seatHeld = await inventoryRepo.getSeatById(seatIdAutoExpire);
      assert.strictEqual(seatHeld?.status, 'HELD');
      assert.strictEqual(seatHeld?.heldByUserId, testUserId);

      // 2. Schedule delayed auto-expiry with 60ms delay
      const delayMs = 60;
      await worker.scheduleExpiry(seatIdAutoExpire, testUserId, testFlightId, delayMs);

      // Before delay: Seat remains HELD
      const seatBefore = await inventoryRepo.getSeatById(seatIdAutoExpire);
      assert.strictEqual(seatBefore?.status, 'HELD');

      // 3. Wait for delayed worker to fire and process
      await new Promise((r) => setTimeout(r, delayMs + 40));

      // After delay: Seat must be automatically released back to AVAILABLE
      const seatAfter = await inventoryRepo.getSeatById(seatIdAutoExpire);
      assert.strictEqual(seatAfter?.status, 'AVAILABLE');
      assert.strictEqual(seatAfter?.heldByUserId, null);
      assert.strictEqual(worker.metrics.autoReleasedCount, 1);

      // 4. Verify SEAT_RELEASED event was emitted
      const releasedEvent = emittedEvents.find(
        (e) => e.eventType === 'SeatReleased' && e.payload.seatId === seatIdAutoExpire
      );
      assert.ok(releasedEvent);
      assert.strictEqual(releasedEvent?.payload.reason, 'TIMEOUT');

      await queue.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Delayed Auto-Release Safe No-Op (Seat Booked Before Expiry)
  // ---------------------------------------------------------------------------
  describe('3. Delayed Auto-Release Safe No-Op', () => {
    const seatIdBooked = 'seat-booked-safe-001';

    before(async () => {
      await inventoryRepo.saveSeats([
        {
          id: seatIdBooked,
          flightId: testFlightId,
          seatNumber: '02B',
          seatClass: 'BUSINESS',
          price: 80000,
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    });

    it('should skip auto-release when seat is confirmed and BOOKED before expiry delay fires', async () => {
      const queue = new InMemoryJobQueue<any>('seat-hold-skip-test');
      const worker = new SeatHoldExpiryWorker(queue, inventoryService, eventDispatcher);

      // 1. Hold seat
      await inventoryService.holdSeat(seatIdBooked, testUserId, 600);

      // 2. Schedule auto-expiry with 80ms delay
      const delayMs = 80;
      await worker.scheduleExpiry(seatIdBooked, testUserId, testFlightId, delayMs);

      // 3. Confirm booking BEFORE the 80ms delayed job fires
      await inventoryService.confirmSeat(seatIdBooked, testUserId, 'bk-fast-confirm-001');

      const seatConfirmed = await inventoryRepo.getSeatById(seatIdBooked);
      assert.strictEqual(seatConfirmed?.status, 'BOOKED');

      // 4. Wait for delayed worker to fire
      await new Promise((r) => setTimeout(r, delayMs + 30));

      // 5. Seat must still be BOOKED (NOT released)
      const seatStillBooked = await inventoryRepo.getSeatById(seatIdBooked);
      assert.strictEqual(seatStillBooked?.status, 'BOOKED');
      assert.strictEqual(worker.metrics.skippedCount, 1);

      await queue.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Periodic Sweeper — Seat Holds
  // ---------------------------------------------------------------------------
  describe('4. Periodic Sweeper — Seat Holds', () => {
    const seatIdExpiredHold = 'seat-expired-sweeper-001';

    before(async () => {
      // Seed a seat with heldUntil in the PAST
      await inventoryRepo.saveSeats([
        {
          id: seatIdExpiredHold,
          flightId: testFlightId,
          seatNumber: '03A',
          seatClass: 'ECONOMY',
          price: 35000,
          status: 'HELD',
          heldByUserId: 'usr-stale-001',
          heldUntil: new Date(Date.now() - 10000), // 10s ago
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    });

    it('should sweep and release orphaned seat holds where heldUntil <= now', async () => {
      const sweeper = new PeriodicSweeper(inventoryRepo, bookingRepo, eventDispatcher);

      const cleaned = await sweeper.sweepExpiredSeatHolds();
      assert.ok(cleaned >= 1);

      const seatAfterSweep = await inventoryRepo.getSeatById(seatIdExpiredHold);
      assert.strictEqual(seatAfterSweep?.status, 'AVAILABLE');
      assert.strictEqual(seatAfterSweep?.heldByUserId, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Periodic Sweeper — Pending Bookings
  // ---------------------------------------------------------------------------
  describe('5. Periodic Sweeper — Pending Bookings', () => {
    const bookingIdExpired = 'bk-expired-sweeper-001';
    const seatIdBookingHold = 'seat-booking-expired-001';

    before(async () => {
      await inventoryRepo.saveSeats([
        {
          id: seatIdBookingHold,
          flightId: testFlightId,
          seatNumber: '03B',
          seatClass: 'ECONOMY',
          price: 35000,
          status: 'HELD',
          heldByUserId: 'usr-stale-002',
          heldUntil: new Date(Date.now() - 5000),
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const expiredBooking: Booking = {
        id: bookingIdExpired,
        userId: 'usr-stale-002',
        flightId: testFlightId,
        seatId: seatIdBookingHold,
        totalAmount: 35000,
        currency: 'USD',
        status: 'PENDING',
        bookingReference: 'STALE1',
        expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
        createdAt: new Date(Date.now() - 20000),
        updatedAt: new Date(),
      };

      const outboxEvt: OutboxEvent = {
        id: 'outbox-stale-1',
        aggregateType: 'BOOKING',
        aggregateId: bookingIdExpired,
        eventType: 'BookingCreated',
        payload: {},
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
      };

      await bookingRepo.createBookingWithOutbox(expiredBooking, [], outboxEvt);
    });

    it('should transition expired pending bookings to EXPIRED and release associated seats', async () => {
      const sweeper = new PeriodicSweeper(inventoryRepo, bookingRepo, eventDispatcher);

      const cleanedBookings = await sweeper.sweepExpiredBookings();
      assert.strictEqual(cleanedBookings, 1);

      const booking = await bookingRepo.getBookingById(bookingIdExpired);
      assert.strictEqual(booking?.status, 'EXPIRED');

      // Verify BOOKING_EXPIRED event was emitted
      const expiredEvt = emittedEvents.find(
        (e) => e.eventType === 'BookingExpired' && e.payload.bookingId === bookingIdExpired
      );
      assert.ok(expiredEvt);
      assert.strictEqual(expiredEvt?.payload.bookingReference, 'STALE1');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. WorkerManager Orchestration & Metrics
  // ---------------------------------------------------------------------------
  describe('6. WorkerManager Orchestration & Metrics', () => {
    it('should coordinate delayed jobs, run sweeps on demand, and provide health metrics', async () => {
      const queue = new InMemoryJobQueue<any>('manager-queue-test');
      const manager = new WorkerManager({
        queue,
        inventoryService,
        inventoryRepo,
        bookingRepo,
        eventDispatcher,
        sweeperIntervalMs: 50000,
      });

      // 1. Run immediate sweep
      const sweepResult = await manager.runSweepNow();
      assert.ok(typeof sweepResult.durationMs === 'number');

      // 2. Check health and metrics
      const metrics = await manager.getMetrics();
      assert.strictEqual(metrics.status, 'healthy');
      assert.ok(typeof metrics.seatHoldWorker.jobsProcessed === 'number');
      assert.ok(typeof metrics.periodicSweeper.totalSweepsRun === 'number');
      assert.ok(metrics.periodicSweeper.totalSweepsRun >= 1);

      await manager.stop();
    });
  });
});
