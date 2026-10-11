import { describe, it } from 'node:test';
import assert from 'node:assert';

// 1. Test @airline/types
import {
  UserRole,
  FlightStatus,
  SeatStatus,
  BookingStatus,
  PaymentStatus,
  SeatClass
} from '../packages/types/src/index';

// 2. Test @airline/events
import {
  KAFKA_TOPICS,
  createEvent,
  EventEnvelope,
  SeatHeldPayload
} from '../packages/events/src/index';

// 3. Test @airline/logger
import {
  createLogger,
  Logger
} from '../packages/logger/src/index';

// 4. Test @airline/db
import {
  users,
  airlines,
  airports,
  aircrafts,
  flights,
  flightSeats,
  bookings,
  passengers,
  payments,
  outboxEvents,
  idempotencyKeys,
  DatabaseClient,
  getDatabaseClient
} from '../packages/db/src/index';

describe('Phase 1 Foundation - Comprehensive Pass Checks', () => {

  describe('@airline/types validation', () => {
    it('should define valid domain roles and statuses', () => {
      const validRole: UserRole = 'ADMIN';
      const validFlightStatus: FlightStatus = 'SCHEDULED';
      const validSeatStatus: SeatStatus = 'AVAILABLE';
      const validBookingStatus: BookingStatus = 'CONFIRMED';
      const validPaymentStatus: PaymentStatus = 'SUCCESS';
      const validSeatClass: SeatClass = 'BUSINESS';

      assert.strictEqual(validRole, 'ADMIN');
      assert.strictEqual(validFlightStatus, 'SCHEDULED');
      assert.strictEqual(validSeatStatus, 'AVAILABLE');
      assert.strictEqual(validBookingStatus, 'CONFIRMED');
      assert.strictEqual(validPaymentStatus, 'SUCCESS');
      assert.strictEqual(validSeatClass, 'BUSINESS');
    });
  });

  describe('@airline/events validation', () => {
    it('should contain all required Kafka topic definitions', () => {
      assert.ok(KAFKA_TOPICS.FLIGHT_CREATED);
      assert.ok(KAFKA_TOPICS.SEAT_HELD);
      assert.ok(KAFKA_TOPICS.SEAT_RELEASED);
      assert.ok(KAFKA_TOPICS.BOOKING_CREATED);
      assert.ok(KAFKA_TOPICS.BOOKING_CONFIRMED);
      assert.ok(KAFKA_TOPICS.BOOKING_CANCELLED);
      assert.ok(KAFKA_TOPICS.PAYMENT_SUCCESS);
      assert.ok(KAFKA_TOPICS.PAYMENT_FAILED);
      assert.ok(KAFKA_TOPICS.DEAD_LETTER_QUEUE);

      assert.strictEqual(KAFKA_TOPICS.SEAT_HELD, 'airline.inventory.seat.held');
      assert.strictEqual(KAFKA_TOPICS.BOOKING_CONFIRMED, 'airline.booking.confirmed');
    });

    it('should create valid event envelopes with correlation IDs', () => {
      const payload: SeatHeldPayload = {
        flightId: 'flight-uuid-1',
        seatId: 'seat-uuid-1',
        seatNumber: '14B',
        userId: 'user-uuid-1',
        heldUntil: new Date().toISOString(),
        price: 25000,
      };

      const event: EventEnvelope<SeatHeldPayload> = createEvent(
        KAFKA_TOPICS.SEAT_HELD,
        'SeatHeld',
        'inventory-service',
        payload,
        'custom-correlation-123'
      );

      assert.ok(event.eventId);
      assert.strictEqual(event.eventType, 'SeatHeld');
      assert.strictEqual(event.topic, KAFKA_TOPICS.SEAT_HELD);
      assert.strictEqual(event.correlationId, 'custom-correlation-123');
      assert.strictEqual(event.sourceService, 'inventory-service');
      assert.strictEqual(event.payload.seatNumber, '14B');
      assert.ok(new Date(event.timestamp).getTime() > 0);
    });

    it('should auto-generate correlationId if none provided', () => {
      const event = createEvent(
        KAFKA_TOPICS.BOOKING_CANCELLED,
        'BookingCancelled',
        'booking-service',
        { bookingId: 'b-1' }
      );

      assert.ok(event.correlationId.startsWith('corr-'));
    });
  });

  describe('@airline/logger validation', () => {
    it('should initialize Logger with service name and log level', () => {
      const logger = createLogger('test-service', { level: 'debug' });
      assert.ok(logger instanceof Logger);
      assert.strictEqual(logger.serviceName, 'test-service');
    });

    it('should create child loggers with contextual metadata', () => {
      const logger = createLogger('auth-service');
      const child = logger.child({ correlationId: 'req-999', userId: 'usr-123' });
      assert.ok(child);
      assert.strictEqual(typeof child.info, 'function');
      assert.strictEqual(typeof child.error, 'function');
    });
  });

  describe('@airline/db validation', () => {
    it('should export all required schema tables with valid columns', () => {
      assert.ok(users);
      assert.ok(airlines);
      assert.ok(airports);
      assert.ok(aircrafts);
      assert.ok(flights);
      assert.ok(flightSeats);
      assert.ok(bookings);
      assert.ok(passengers);
      assert.ok(payments);
      assert.ok(outboxEvents);
      assert.ok(idempotencyKeys);

      // Verify key columns
      assert.ok(users.email);
      assert.ok(users.passwordHash);
      assert.ok(users.role);

      assert.ok(flights.flightNumber);
      assert.ok(flights.basePrice);

      assert.ok(flightSeats.seatNumber);
      assert.ok(flightSeats.status);
      assert.ok(flightSeats.version); // OCC version

      assert.ok(bookings.bookingReference);
      assert.ok(bookings.status);

      assert.ok(outboxEvents.aggregateType);
      assert.ok(outboxEvents.status);

      assert.ok(idempotencyKeys.idempotencyKey);
    });

    it('should create and manage DatabaseClient instance', () => {
      const client = new DatabaseClient({
        connectionString: 'postgresql://test_user:test_secret@localhost:5432/test_db',
        maxConnections: 5,
      });

      assert.ok(client);
      assert.ok(client.db);
      assert.ok(client.getPool());
      assert.strictEqual(typeof client.testConnection, 'function');
      assert.strictEqual(typeof client.close, 'function');

      const singleton = getDatabaseClient();
      assert.ok(singleton);
    });
  });

});
