import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ==========================================
// 1. Users Table
// ==========================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('USER'), // 'USER' | 'ADMIN' | 'AIRLINE_ADMIN' | 'SUPPORT'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_users_email').on(table.email),
]);

// ==========================================
// 2. Airlines Table
// ==========================================
export const airlines = pgTable('airlines', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 10 }).notNull().unique(), // e.g. "AA", "AI", "DL"
  name: varchar('name', { length: 255 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_airlines_code').on(table.code),
]);

// ==========================================
// 3. Airports Table
// ==========================================
export const airports = pgTable('airports', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 10 }).notNull().unique(), // e.g. "JFK", "DEL", "LHR"
  name: varchar('name', { length: 255 }).notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('UTC'),
  latitude: doublePrecision('latitude').notNull().default(0.0),
  longitude: doublePrecision('longitude').notNull().default(0.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_airports_code').on(table.code),
  index('idx_airports_city').on(table.city),
]);

// ==========================================
// 4. Aircrafts Table
// ==========================================
export const aircrafts = pgTable('aircrafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  airlineId: uuid('airline_id').notNull().references(() => airlines.id, { onDelete: 'cascade' }),
  model: varchar('model', { length: 100 }).notNull(),
  totalSeats: integer('total_seats').notNull(),
  seatConfiguration: jsonb('seat_configuration').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_aircrafts_airline').on(table.airlineId),
]);

// ==========================================
// 5. Flights Table
// ==========================================
export const flights = pgTable('flights', {
  id: uuid('id').primaryKey().defaultRandom(),
  airlineId: uuid('airline_id').notNull().references(() => airlines.id, { onDelete: 'cascade' }),
  aircraftId: uuid('aircraft_id').notNull().references(() => aircrafts.id, { onDelete: 'cascade' }),
  flightNumber: varchar('flight_number', { length: 50 }).notNull(),
  originAirportId: uuid('origin_airport_id').notNull().references(() => airports.id),
  destinationAirportId: uuid('destination_airport_id').notNull().references(() => airports.id),
  departureTime: timestamp('departure_time', { withTimezone: true }).notNull(),
  arrivalTime: timestamp('arrival_time', { withTimezone: true }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('SCHEDULED'),
  basePrice: integer('base_price').notNull(), // stored in cents/smallest currency unit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_flights_route').on(table.originAirportId, table.destinationAirportId, table.departureTime),
  index('idx_flights_number').on(table.flightNumber),
  index('idx_flights_status').on(table.status),
]);

// ==========================================
// 6. Flight Seats Table (Critical Concurrency Core)
// ==========================================
export const flightSeats = pgTable('flight_seats', {
  id: uuid('id').primaryKey().defaultRandom(),
  flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
  seatNumber: varchar('seat_number', { length: 10 }).notNull(),
  seatClass: varchar('seat_class', { length: 50 }).notNull().default('ECONOMY'),
  price: integer('price').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('AVAILABLE'), // 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED'
  heldByUserId: uuid('held_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  heldUntil: timestamp('held_until', { withTimezone: true }),
  version: integer('version').notNull().default(1), // Optimistic Concurrency Control
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_flight_seat_unique').on(table.flightId, table.seatNumber),
  index('idx_flight_seat_status').on(table.flightId, table.status),
  index('idx_flight_seat_held_until').on(table.heldUntil),
]);

// ==========================================
// 7. Bookings Table
// ==========================================
export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  flightId: uuid('flight_id').notNull().references(() => flights.id),
  seatId: uuid('seat_id').notNull().references(() => flightSeats.id),
  totalAmount: integer('total_amount').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  status: varchar('status', { length: 50 }).notNull().default('PENDING'), // 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'
  bookingReference: varchar('booking_reference', { length: 20 }).notNull().unique(), // PNR e.g. "X7K9PQ"
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_bookings_user').on(table.userId),
  index('idx_bookings_pnr').on(table.bookingReference),
  index('idx_bookings_status').on(table.status),
]);

// ==========================================
// 8. Passengers Table
// ==========================================
export const passengers = pgTable('passengers', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  passportNumber: varchar('passport_number', { length: 50 }),
  seatId: uuid('seat_id').notNull().references(() => flightSeats.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_passengers_booking').on(table.bookingId),
]);

// ==========================================
// 9. Payments Table
// ==========================================
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  method: varchar('method', { length: 50 }).notNull().default('CREDIT_CARD'),
  status: varchar('status', { length: 50 }).notNull().default('PENDING'), // 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED'
  transactionId: varchar('transaction_id', { length: 100 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_payments_booking').on(table.bookingId),
  index('idx_payments_user').on(table.userId),
  index('idx_payments_status').on(table.status),
]);

// ==========================================
// 10. Outbox Events Table (Reliable Transactional Outbox Pattern)
// ==========================================
export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  aggregateType: varchar('aggregate_type', { length: 100 }).notNull(), // 'BOOKING' | 'PAYMENT' | 'INVENTORY'
  aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('PENDING'), // 'PENDING' | 'PUBLISHED' | 'FAILED'
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [
  index('idx_outbox_status_created').on(table.status, table.createdAt),
]);

// ==========================================
// 11. Idempotency Keys Table
// ==========================================
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  handlerName: varchar('handler_name', { length: 100 }).notNull(),
  responsePayload: jsonb('response_payload').notNull(),
  statusCode: integer('status_code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_idempotency_key').on(table.idempotencyKey),
]);
