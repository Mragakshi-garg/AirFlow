import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  generateFullDataset,
  generateFlights,
  generateSeatsForFlight,
  SEED_AIRLINES,
  SEED_AIRPORTS,
  SEED_AIRCRAFTS,
  SEED_USERS,
  runSeeder
} from '../packages/db/src/index';

describe('Phase 2 Database Schema & Seed Script - Comprehensive Pass Checks', () => {

  describe('1. 1000+ Flight Generation Verification', () => {
    const targetCount = 1050;
    const { flights, flightSeats } = generateFlights(targetCount);

    it('should generate at least 1,000 distinct scheduled flights', () => {
      assert.ok(flights.length >= 1000, `Expected at least 1000 flights, got ${flights.length}`);
    });

    it('should ensure all flights have valid scheduling, pricing and routes', () => {
      for (const flight of flights.slice(0, 100)) {
        assert.ok(flight.id, 'Flight ID must exist');
        assert.ok(flight.flightNumber, 'Flight number must exist');
        assert.ok(flight.originAirportId, 'Origin airport ID must exist');
        assert.ok(flight.destinationAirportId, 'Destination airport ID must exist');
        assert.notStrictEqual(
          flight.originAirportId,
          flight.destinationAirportId,
          'Origin and Destination cannot be identical'
        );
        assert.ok(flight.departureTime instanceof Date, 'Departure time must be a Date');
        assert.ok(flight.arrivalTime instanceof Date, 'Arrival time must be a Date');
        assert.ok(
          flight.arrivalTime.getTime() > flight.departureTime.getTime(),
          'Arrival time must be strictly after departure time'
        );
        assert.ok(flight.durationMinutes > 0, 'Duration must be positive');
        assert.ok(flight.basePrice >= 15000, 'Base price must be reasonable (>= $150 in cents)');
        assert.strictEqual(flight.status, 'SCHEDULED');
      }
    });

    it('should generate flights across the 30-day scheduling horizon', () => {
      const departureTimes = flights.map((f) => f.departureTime.getTime());
      const minTime = Math.min(...departureTimes);
      const maxTime = Math.max(...departureTimes);
      const spanDays = (maxTime - minTime) / (1000 * 60 * 60 * 24);

      assert.ok(spanDays >= 20, `Flights should span at least 20 days into future, got ${spanDays.toFixed(1)} days`);
    });
  });

  describe('2. Seat Inventory & Concurrency Core Data Verification', () => {
    it('should generate seats with proper classes and OCC version = 1', () => {
      const testFlightId = 'flt-test-001';
      const basePrice = 20000;
      const seats = generateSeatsForFlight(testFlightId, basePrice, 20);

      assert.ok(seats.length > 50, 'Flight should have full seat matrix');

      const firstClassSeats = seats.filter((s) => s.seatClass === 'FIRST');
      const businessSeats = seats.filter((s) => s.seatClass === 'BUSINESS');
      const premiumEcoSeats = seats.filter((s) => s.seatClass === 'PREMIUM_ECONOMY');
      const economySeats = seats.filter((s) => s.seatClass === 'ECONOMY');

      assert.ok(firstClassSeats.length > 0, 'Must have First Class seats');
      assert.ok(businessSeats.length > 0, 'Must have Business Class seats');
      assert.ok(premiumEcoSeats.length > 0, 'Must have Premium Economy seats');
      assert.ok(economySeats.length > 0, 'Must have Economy Class seats');

      // Check pricing tier hierarchy: FIRST > BUSINESS > PREMIUM_ECONOMY > ECONOMY
      assert.ok(firstClassSeats[0].price > businessSeats[0].price);
      assert.ok(businessSeats[0].price > premiumEcoSeats[0].price);
      assert.ok(premiumEcoSeats[0].price > economySeats[0].price);

      // Verify Optimistic Concurrency Control field
      for (const seat of seats) {
        assert.strictEqual(seat.version, 1, 'Initial OCC version must be exactly 1');
        assert.strictEqual(seat.status, 'AVAILABLE', 'Initial seat status must be AVAILABLE');
        assert.strictEqual(seat.heldByUserId, null);
        assert.strictEqual(seat.heldUntil, null);
      }
    });
  });

  describe('3. Full Dataset Verification (Airlines, Airports, Aircrafts, Users)', () => {
    const dataset = generateFullDataset(1000);

    it('should include curated airlines, airports, aircrafts, and users', () => {
      assert.strictEqual(dataset.airlines.length, SEED_AIRLINES.length);
      assert.strictEqual(dataset.airports.length, SEED_AIRPORTS.length);
      assert.strictEqual(dataset.aircrafts.length, SEED_AIRCRAFTS.length);
      assert.strictEqual(dataset.users.length, SEED_USERS.length);
      assert.ok(dataset.flights.length >= 1000);
      assert.ok(dataset.flightSeats.length > 5000);
    });

    it('should include required user roles (ADMIN, AIRLINE_ADMIN, SUPPORT, USER)', () => {
      const roles = dataset.users.map((u) => u.role);
      assert.ok(roles.includes('ADMIN'));
      assert.ok(roles.includes('AIRLINE_ADMIN'));
      assert.ok(roles.includes('SUPPORT'));
      assert.ok(roles.includes('USER'));
    });
  });

  describe('4. Partitioning & Schema DDL Validation', () => {
    it('should verify 0001_initial_schema.sql contains all core tables', () => {
      const migration1Path = path.resolve(__dirname, '../packages/db/migrations/0001_initial_schema.sql');
      assert.ok(fs.existsSync(migration1Path), '0001_initial_schema.sql must exist');

      const sqlContent = fs.readFileSync(migration1Path, 'utf8');
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS users'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS airlines'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS airports'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS aircrafts'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS flights'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS flight_seats'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS bookings'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS payments'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS outbox_events'));
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS idempotency_keys'));
      assert.ok(sqlContent.includes('version INTEGER NOT NULL DEFAULT 1'));
    });

    it('should verify 0002_partitioning.sql contains RANGE partitions for flights & bookings', () => {
      const migration2Path = path.resolve(__dirname, '../packages/db/migrations/0002_partitioning.sql');
      assert.ok(fs.existsSync(migration2Path), '0002_partitioning.sql must exist');

      const sqlContent = fs.readFileSync(migration2Path, 'utf8');
      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS flights_partitioned'));
      assert.ok(sqlContent.includes('PARTITION BY RANGE (departure_time)'));
      assert.ok(sqlContent.includes('flights_2026_10 PARTITION OF flights_partitioned'));

      assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS bookings_partitioned'));
      assert.ok(sqlContent.includes('PARTITION BY RANGE (created_at)'));
      assert.ok(sqlContent.includes('bookings_2026_10 PARTITION OF bookings_partitioned'));
    });
  });

  describe('5. Seeder Execution (Dry-Run Mode)', () => {
    it('should run seeder in dry-run mode without errors', async () => {
      const result = await runSeeder({ targetFlights: 1000, dryRun: true });
      assert.ok(result);
      assert.ok(result.flights.length >= 1000);
      assert.ok(result.flightSeats.length > 5000);
    });
  });

});
