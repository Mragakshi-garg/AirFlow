import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';

import {
  BookingRepository,
  InMemoryBookingRepository,
  BookingService,
  OutboxRelay,
  generatePNR,
  createBookingApp,
} from '../services/booking-service/src/index';

import {
  InventoryService,
  InMemoryInventoryRepository,
  RedlockManager,
} from '../services/inventory-service/src/index';

import {
  PaymentService,
  InMemoryPaymentRepository,
} from '../services/payment-service/src/index';

import { FlightSeat, OutboxEvent } from '@airline/types';

describe('Phase 6 Booking, Payment & Transactional Outbox (Saga) - Comprehensive Pass Checks', () => {
  let server: http.Server;
  let baseUrl: string;

  let inventoryRepo: InMemoryInventoryRepository;
  let inventoryService: InventoryService;

  let paymentRepo: InMemoryPaymentRepository;
  let paymentService: PaymentService;

  let bookingRepo: InMemoryBookingRepository;
  let bookingService: BookingService;

  let relayedEvents: OutboxEvent[] = [];
  let outboxRelay: OutboxRelay;

  const testFlightId = 'flt-saga-phase6-001';
  const testUserId = 'usr-saga-phase6-001';
  const testSeatId = 'seat-saga-phase6-001';
  const testSeatIdFail = 'seat-saga-phase6-002';
  const testSeatIdCancel = 'seat-saga-phase6-003';

  before(async () => {
    // 1. Setup Inventory
    inventoryRepo = new InMemoryInventoryRepository();
    const redlock = new RedlockManager();
    inventoryService = new InventoryService(inventoryRepo, redlock);

    const initialSeats: FlightSeat[] = [
      {
        id: testSeatId,
        flightId: testFlightId,
        seatNumber: '04A',
        seatClass: 'BUSINESS',
        price: 95000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: testSeatIdFail,
        flightId: testFlightId,
        seatNumber: '04B',
        seatClass: 'BUSINESS',
        price: 95000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: testSeatIdCancel,
        flightId: testFlightId,
        seatNumber: '04C',
        seatClass: 'BUSINESS',
        price: 95000,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    await inventoryRepo.saveSeats(initialSeats);

    // 2. Setup Payment
    paymentRepo = new InMemoryPaymentRepository();
    paymentService = new PaymentService(paymentRepo);

    // 3. Setup Booking & Outbox
    bookingRepo = new InMemoryBookingRepository();
    bookingService = new BookingService(bookingRepo, inventoryService, paymentService);

    relayedEvents = [];
    outboxRelay = new OutboxRelay(bookingRepo, async (event) => {
      relayedEvents.push(event);
    });

    // 4. Setup Express Server
    const appSetup = createBookingApp({
      repo: bookingRepo,
      inventoryService,
      paymentService,
      bookingService,
      outboxRelay,
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
    if (outboxRelay) outboxRelay.stop();
  });

  // ---------------------------------------------------------------------------
  // 1. PNR Generation & Format
  // ---------------------------------------------------------------------------
  describe('1. PNR Generation & Format', () => {
    it('should generate valid 6-character uppercase alphanumeric PNR without ambiguous chars', () => {
      const generated = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const pnr = generatePNR();
        assert.strictEqual(pnr.length, 6, `PNR must be 6 characters: ${pnr}`);
        assert.match(pnr, /^[2-9A-HJ-NP-Z]{6}$/, `PNR contains invalid characters: ${pnr}`);
        assert.ok(!pnr.includes('0') && !pnr.includes('O'), 'Must not include 0 or O');
        assert.ok(!pnr.includes('1') && !pnr.includes('I'), 'Must not include 1 or I');
        generated.add(pnr);
      }
      assert.strictEqual(generated.size, 100, 'All 100 generated PNRs should be distinct');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Transactional Outbox Pattern
  // ---------------------------------------------------------------------------
  describe('2. Transactional Outbox Pattern', () => {
    it('should save outbox events in PENDING status and relay them to subscribers', async () => {
      // Manually add an outbox event
      const testEvent: OutboxEvent = {
        id: `outbox-test-manual-${Date.now()}`,
        aggregateType: 'BOOKING',
        aggregateId: 'test-agg-1',
        eventType: 'BookingCreated',
        payload: { test: true },
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
      };
      await bookingRepo.saveOutboxEvent(testEvent);

      const pendingBefore = await bookingRepo.getPendingOutboxEvents();
      assert.ok(pendingBefore.some((e) => e.id === testEvent.id));

      // Trigger Outbox Relay sweep
      const count = await outboxRelay.relayBatch();
      assert.ok(count >= 1);

      // Verify the event status was updated to PUBLISHED
      const pendingAfter = await bookingRepo.getPendingOutboxEvents();
      assert.ok(!pendingAfter.some((e) => e.id === testEvent.id));

      const relayed = relayedEvents.find((e) => e.id === testEvent.id);
      assert.ok(relayed, 'Event must have been received by subscriber');
      assert.strictEqual(relayed?.eventType, 'BookingCreated');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Saga Orchestrator — Happy Path
  // ---------------------------------------------------------------------------
  describe('3. Saga Orchestrator — Happy Path (Complete Reservation Flow)', () => {
    it('should hold seat, process payment, confirm seat, and transition booking to CONFIRMED', async () => {
      // Step A: User holds seat
      const holdResult = await inventoryService.holdSeat(testSeatId, testUserId, 600);
      assert.strictEqual(holdResult.success, true);
      assert.strictEqual(holdResult.seat.status, 'HELD');

      // Step B: User initiates Booking Saga
      const sagaResult = await bookingService.createBooking({
        flightId: testFlightId,
        seatId: testSeatId,
        userId: testUserId,
        passengers: [
          {
            firstName: 'John',
            lastName: 'Doe',
            passportNumber: 'A12345678',
            seatId: testSeatId,
            seatNumber: '04A',
          },
        ],
        totalAmount: 95000,
        currency: 'USD',
        paymentMethod: 'CREDIT_CARD',
      });

      assert.strictEqual(sagaResult.success, true);
      assert.strictEqual(sagaResult.sagaState, 'COMPLETED');
      assert.strictEqual(sagaResult.booking.status, 'CONFIRMED');
      assert.ok(sagaResult.pnr);
      assert.ok(sagaResult.payment);
      assert.strictEqual(sagaResult.payment.status, 'SUCCESS');
      assert.ok(sagaResult.payment.transactionId);

      // Step C: Verify seat in Inventory transitioned to BOOKED
      const seatAfterBooking = await inventoryRepo.getSeatById(testSeatId);
      assert.strictEqual(seatAfterBooking?.status, 'BOOKED');

      // Step D: Verify Outbox Events contain BookingCreated and BookingConfirmed
      const pendingOutbox = await bookingRepo.getPendingOutboxEvents();
      assert.ok(pendingOutbox.some((e) => e.eventType === 'BookingConfirmed'));
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Saga Orchestrator — Compensating Transaction (Payment Failure)
  // ---------------------------------------------------------------------------
  describe('4. Saga Orchestrator — Compensating Transaction (Payment Failure)', () => {
    it('should rollback seat hold back to AVAILABLE when payment fails', async () => {
      // Step A: Hold seat
      const holdResult = await inventoryService.holdSeat(testSeatIdFail, testUserId, 600);
      assert.strictEqual(holdResult.seat.status, 'HELD');

      // Step B: Initiate Saga with simulated payment failure (e.g. card declined)
      const sagaResult = await bookingService.createBooking({
        flightId: testFlightId,
        seatId: testSeatIdFail,
        userId: testUserId,
        passengers: [
          {
            firstName: 'Alice',
            lastName: 'Smith',
            seatId: testSeatIdFail,
            seatNumber: '04B',
          },
        ],
        totalAmount: 95000,
        simulatePaymentFailure: true,
        failureReason: 'INSUFFICIENT_FUNDS',
      });

      // Assert Saga failure and compensation
      assert.strictEqual(sagaResult.success, false);
      assert.strictEqual(sagaResult.sagaState, 'COMPENSATED');
      assert.strictEqual(sagaResult.booking.status, 'FAILED');
      assert.strictEqual(sagaResult.errorMessage, 'INSUFFICIENT_FUNDS');

      // Step C: Verify compensation - Held seat was automatically released back to AVAILABLE
      const seatAfterRollback = await inventoryRepo.getSeatById(testSeatIdFail);
      assert.strictEqual(
        seatAfterRollback?.status,
        'AVAILABLE',
        'Seat must be released back to AVAILABLE on payment failure'
      );
      assert.strictEqual(seatAfterRollback?.heldByUserId, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Strict Idempotency Verification
  // ---------------------------------------------------------------------------
  describe('5. Strict Idempotency Verification', () => {
    it('should return identical cached response on duplicate requests with same Idempotency-Key', async () => {
      const idempotencyKey = `idem-key-${Date.now()}`;

      // Hold seat
      await inventoryService.holdSeat(testSeatIdCancel, testUserId, 600);

      const requestPayload = {
        flightId: testFlightId,
        seatId: testSeatIdCancel,
        userId: testUserId,
        passengers: [
          {
            firstName: 'Bob',
            lastName: 'Williams',
            seatId: testSeatIdCancel,
            seatNumber: '04C',
          },
        ],
        totalAmount: 95000,
        idempotencyKey,
      };

      // 1st Execution
      const firstResult = await bookingService.createBooking(requestPayload);
      assert.strictEqual(firstResult.success, true);
      assert.strictEqual(firstResult.cached, undefined);
      const originalPnr = firstResult.pnr;
      const originalBookingId = firstResult.booking.id;

      // 2nd Execution with same Idempotency-Key
      const secondResult = await bookingService.createBooking(requestPayload);
      assert.strictEqual(secondResult.success, true);
      assert.strictEqual(secondResult.cached, true);
      assert.strictEqual(secondResult.pnr, originalPnr, 'PNR must match cached response');
      assert.strictEqual(secondResult.booking.id, originalBookingId, 'Booking ID must match');

      // Verify payment was NOT processed twice
      const payments = await paymentRepo.getPaymentsByBookingId(originalBookingId);
      assert.strictEqual(payments.length, 1, 'Payment must only be processed once');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Booking Service HTTP API Endpoints
  // ---------------------------------------------------------------------------
  describe('6. Booking Service HTTP API Endpoints', () => {
    let httpPnr: string;
    let httpBookingId: string;
    const httpSeatId = 'seat-saga-http-001';

    before(async () => {
      await inventoryRepo.saveSeats([
        {
          id: httpSeatId,
          flightId: testFlightId,
          seatNumber: '10F',
          seatClass: 'ECONOMY',
          price: 45000,
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      await inventoryService.holdSeat(httpSeatId, 'usr-http-1', 600);
    });

    it('POST /api/bookings should create booking and return 201 with PNR', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-idem-001',
        },
        body: JSON.stringify({
          flightId: testFlightId,
          seatId: httpSeatId,
          userId: 'usr-http-1',
          passengers: [
            {
              firstName: 'Emily',
              lastName: 'Clark',
              seatId: httpSeatId,
              seatNumber: '10F',
            },
          ],
          totalAmount: 45000,
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.ok(body.pnr);
      assert.strictEqual(body.sagaState, 'COMPLETED');
      assert.strictEqual(body.booking.status, 'CONFIRMED');

      httpPnr = body.pnr;
      httpBookingId = body.booking.id;
    });

    it('POST /api/bookings with duplicate Idempotency-Key header should return cached 201', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-idem-001',
        },
        body: JSON.stringify({
          flightId: testFlightId,
          seatId: httpSeatId,
          userId: 'usr-http-1',
          totalAmount: 45000,
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = (await res.json()) as any;
      assert.strictEqual(body.cached, true);
      assert.strictEqual(body.pnr, httpPnr);
    });

    it('GET /api/bookings/:id should return booking details and passenger info', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${httpBookingId}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.booking.id, httpBookingId);
      assert.strictEqual(body.booking.passengers[0].firstName, 'Emily');
    });

    it('GET /api/bookings/pnr/:pnr should return booking by reference', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/pnr/${httpPnr}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.booking.bookingReference, httpPnr);
    });

    it('POST /api/bookings/outbox/relay should trigger outbox relay sweep', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/outbox/relay`, {
        method: 'POST',
      });
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.ok(typeof body.publishedCount === 'number');
    });

    it('POST /api/bookings/:id/cancel should cancel booking and release seat', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${httpBookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'usr-http-1',
          reason: 'USER_CANCELLED',
        }),
      });
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.booking.status, 'CANCELLED');

      // Verify seat is available again
      const seat = await inventoryRepo.getSeatById(httpSeatId);
      assert.strictEqual(seat?.status, 'AVAILABLE');
    });
  });
});
