import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';

import {
  InMemorySearchIndex,
  SearchCacheService,
  FlightSearchService,
  FlightSearchDocument,
  createSearchApp,
} from '../services/search-service/src/index';
import { createEvent, KAFKA_TOPICS } from '@airline/events';
import { Flight } from '@airline/types';

describe('Phase 5 Flight Search & Caching - Comprehensive Pass Checks', () => {
  let server: http.Server;
  let baseUrl: string;
  let index: InMemorySearchIndex;
  let cache: SearchCacheService;
  let searchService: FlightSearchService;

  const sampleFlights: FlightSearchDocument[] = [
    {
      id: 'flt-search-001',
      flightNumber: 'EK-201',
      airlineId: '11111111-1111-4111-a111-111111111111',
      airlineCode: 'EK',
      airlineName: 'Emirates',
      originAirportId: 'a1111111-0000-4000-a000-000000000001',
      originAirportCode: 'JFK',
      originAirportCity: 'New York',
      destinationAirportId: 'a1111111-0000-4000-a000-000000000003',
      destinationAirportCode: 'DXB',
      destinationAirportCity: 'Dubai',
      departureTime: '2026-11-01T08:00:00.000Z',
      arrivalTime: '2026-11-01T20:30:00.000Z',
      durationMinutes: 750,
      status: 'SCHEDULED',
      basePrice: 65000, // $650
      availableSeatsCount: 220,
    },
    {
      id: 'flt-search-002',
      flightNumber: 'AI-101',
      airlineId: '55555555-5555-4555-a555-555555555555',
      airlineCode: 'AI',
      airlineName: 'Air India',
      originAirportId: 'a1111111-0000-4000-a000-000000000005',
      originAirportCode: 'DEL',
      originAirportCity: 'New Delhi',
      destinationAirportId: 'a1111111-0000-4000-a000-000000000001',
      destinationAirportCode: 'JFK',
      destinationAirportCity: 'New York',
      departureTime: '2026-11-01T02:00:00.000Z',
      arrivalTime: '2026-11-01T17:30:00.000Z',
      durationMinutes: 930,
      status: 'SCHEDULED',
      basePrice: 55000, // $550
      availableSeatsCount: 180,
    },
    {
      id: 'flt-search-003',
      flightNumber: 'BA-112',
      airlineId: '33333333-3333-4333-a333-333333333333',
      airlineCode: 'BA',
      airlineName: 'British Airways',
      originAirportId: 'a1111111-0000-4000-a000-000000000001',
      originAirportCode: 'JFK',
      originAirportCity: 'New York',
      destinationAirportId: 'a1111111-0000-4000-a000-000000000002',
      destinationAirportCode: 'LHR',
      destinationAirportCity: 'London',
      departureTime: '2026-11-01T18:00:00.000Z',
      arrivalTime: '2026-11-02T06:00:00.000Z',
      durationMinutes: 420,
      status: 'SCHEDULED',
      basePrice: 42000, // $420
      availableSeatsCount: 150,
    },
    {
      id: 'flt-search-004',
      flightNumber: 'DL-405',
      airlineId: '44444444-4444-4444-a444-444444444444',
      airlineCode: 'DL',
      airlineName: 'Delta Air Lines',
      originAirportId: 'a1111111-0000-4000-a000-000000000001',
      originAirportCode: 'JFK',
      originAirportCity: 'New York',
      destinationAirportId: 'a1111111-0000-4000-a000-000000000002',
      destinationAirportCode: 'LHR',
      destinationAirportCity: 'London',
      departureTime: '2026-11-01T21:00:00.000Z',
      arrivalTime: '2026-11-02T09:15:00.000Z',
      durationMinutes: 435,
      status: 'SCHEDULED',
      basePrice: 48000, // $480
      availableSeatsCount: 95,
    },
  ];

  before(async () => {
    index = new InMemorySearchIndex();
    cache = new SearchCacheService({ baseTtlSeconds: 300, maxJitterSeconds: 60 });
    searchService = new FlightSearchService(index, cache);

    await searchService.bulkIndexFlights(sampleFlights);

    const appSetup = createSearchApp({
      searchIndex: index,
      cacheService: cache,
      searchService,
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
    if (cache) await cache.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Search Indexing & Document Structure
  // ---------------------------------------------------------------------------
  describe('1. Search Indexing & Document Structure', () => {
    it('should correctly index and count flight search documents', async () => {
      const count = await index.count();
      assert.strictEqual(count, 4);

      const flight = await searchService.getFlightById('flt-search-001');
      assert.ok(flight);
      assert.strictEqual(flight.flightNumber, 'EK-201');
      assert.strictEqual(flight.airlineCode, 'EK');
      assert.strictEqual(flight.originAirportCode, 'JFK');
      assert.strictEqual(flight.destinationAirportCode, 'DXB');
      assert.strictEqual(flight.basePrice, 65000);
      assert.strictEqual(flight.availableSeatsCount, 220);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-Criteria & Faceted Flight Search
  // ---------------------------------------------------------------------------
  describe('2. Multi-Criteria & Faceted Flight Search', () => {
    it('should filter flights by route (origin and destination code)', async () => {
      const res = await searchService.search({
        origin: 'JFK',
        destination: 'LHR',
      });

      assert.strictEqual(res.total, 2);
      const flightNumbers = res.data.map((f) => f.flightNumber);
      assert.ok(flightNumbers.includes('BA-112'));
      assert.ok(flightNumbers.includes('DL-405'));
    });

    it('should match origin by city name', async () => {
      const res = await searchService.search({
        origin: 'New York',
        destination: 'DXB',
      });

      assert.strictEqual(res.total, 1);
      assert.strictEqual(res.data[0].flightNumber, 'EK-201');
    });

    it('should filter flights by price range', async () => {
      const res = await searchService.search({
        minPrice: 40000,
        maxPrice: 50000,
      });

      assert.strictEqual(res.total, 2);
      for (const flight of res.data) {
        assert.ok(flight.basePrice >= 40000 && flight.basePrice <= 50000);
      }
    });

    it('should sort flights by price ascending and descending', async () => {
      const ascRes = await searchService.search({ sortBy: 'price_asc' });
      assert.strictEqual(ascRes.data[0].flightNumber, 'BA-112'); // $420 lowest

      const descRes = await searchService.search({ sortBy: 'price_desc' });
      assert.strictEqual(descRes.data[0].flightNumber, 'EK-201'); // $650 highest
    });

    it('should compute faceted aggregations across matching flights', async () => {
      const facets = await searchService.getFacets();
      assert.strictEqual(facets.totalMatching, 4);
      assert.ok(facets.airlines.length >= 4);

      // Price range aggregation
      assert.strictEqual(facets.priceRange.min, 42000);
      assert.strictEqual(facets.priceRange.max, 65000);
      assert.ok(facets.priceRange.avg > 42000 && facets.priceRange.avg < 65000);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Redis Cache-Aside & Jittered TTL
  // ---------------------------------------------------------------------------
  describe('3. Redis Cache-Aside & Jittered TTL', () => {
    it('should calculate jittered TTL within expected bounds', () => {
      for (let i = 0; i < 20; i++) {
        const ttl = cache.getJitteredTtl();
        assert.ok(ttl >= 300, `TTL must be >= base TTL (300), got ${ttl}`);
        assert.ok(ttl <= 360, `TTL must be <= base TTL + max jitter (360), got ${ttl}`);
      }
    });

    it('should execute cache-aside: miss on first request, hit on second request', async () => {
      await cache.clearAll();

      const query = { origin: 'DEL', destination: 'JFK' };

      // 1. First search -> Cache Miss
      const missRes = await searchService.search(query);
      assert.strictEqual(missRes.cached, false);
      assert.strictEqual(missRes.total, 1);
      assert.strictEqual(missRes.data[0].flightNumber, 'AI-101');

      // 2. Second search -> Cache Hit
      const hitRes = await searchService.search(query);
      assert.strictEqual(hitRes.cached, true);
      assert.strictEqual(hitRes.total, 1);
      assert.strictEqual(hitRes.data[0].flightNumber, 'AI-101');
    });

    it('should purge cache on flight updates', async () => {
      const query = { origin: 'JFK', destination: 'DXB' };

      // Warm cache
      const first = await searchService.search(query);
      assert.strictEqual(first.cached, false);

      const second = await searchService.search(query);
      assert.strictEqual(second.cached, true);

      // Simulate flight status change (e.g. flight delayed)
      await searchService.handleKafkaEvent(
        createEvent(KAFKA_TOPICS.FLIGHT_DELAYED, 'FlightDelayed', 'admin-service', {
          flightId: 'flt-search-001',
          flightNumber: 'EK-201',
          originalDepartureTime: '2026-11-01T08:00:00.000Z',
          newDepartureTime: '2026-11-01T10:00:00.000Z',
        })
      );

      // Next search must be a fresh cache miss and reflect new departure time
      const third = await searchService.search(query);
      assert.strictEqual(third.cached, false);
      assert.strictEqual(third.data[0].status, 'DELAYED');
      assert.strictEqual(third.data[0].departureTime, '2026-11-01T10:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Singleflight / Request Coalescing Under High Concurrency
  // ---------------------------------------------------------------------------
  describe('4. Singleflight / Request Coalescing Under High Concurrency', () => {
    it('should coalesce 50 parallel cache-miss requests into exactly 1 underlying execution', async () => {
      await cache.clearAll();
      cache.metrics.totalQueriesExecuted = 0;
      cache.metrics.coalescedRequests = 0;

      const singleflightQuery = { origin: 'JFK', destination: 'LHR' };

      // Launch 50 concurrent requests simultaneously
      const parallelRequests = 50;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < parallelRequests; i++) {
        promises.push(searchService.search(singleflightQuery));
      }

      const results = await Promise.all(promises);

      // Verify all 50 callers received the same valid response
      assert.strictEqual(results.length, parallelRequests);
      for (const res of results) {
        assert.strictEqual(res.total, 2);
        assert.ok(res.data.length === 2);
      }

      // Verify Singleflight request coalescing
      assert.strictEqual(
        cache.metrics.totalQueriesExecuted,
        1,
        `Expected exactly 1 underlying query execution, got ${cache.metrics.totalQueriesExecuted}`
      );
      assert.strictEqual(
        cache.metrics.coalescedRequests,
        49,
        `Expected 49 requests to be coalesced via Singleflight, got ${cache.metrics.coalescedRequests}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Event-Driven Search Index Synchronization (Kafka)
  // ---------------------------------------------------------------------------
  describe('5. Event-Driven Search Index Synchronization (Kafka)', () => {
    it('should decrement and increment available seats count on seat held/released events', async () => {
      const flightBefore = await searchService.getFlightById('flt-search-003');
      assert.ok(flightBefore);
      const initialSeats = flightBefore.availableSeatsCount;

      // Seat held event
      await searchService.handleKafkaEvent(
        createEvent(KAFKA_TOPICS.SEAT_HELD, 'SeatHeld', 'inventory-service', {
          flightId: 'flt-search-003',
          seatId: 'st-01',
          seatNumber: '12B',
          userId: 'usr-kafka-1',
          heldUntil: new Date().toISOString(),
          price: 42000,
        })
      );

      const flightAfterHold = await searchService.getFlightById('flt-search-003');
      assert.strictEqual(flightAfterHold?.availableSeatsCount, initialSeats - 1);

      // Seat released event
      await searchService.handleKafkaEvent(
        createEvent(KAFKA_TOPICS.SEAT_RELEASED, 'SeatReleased', 'inventory-service', {
          flightId: 'flt-search-003',
          seatId: 'st-01',
          seatNumber: '12B',
          reason: 'USER_CANCELLED',
        })
      );

      const flightAfterRelease = await searchService.getFlightById('flt-search-003');
      assert.strictEqual(flightAfterRelease?.availableSeatsCount, initialSeats);
    });

    it('should index new flight on FLIGHT_CREATED event', async () => {
      const newFlight: Flight = {
        id: 'flt-search-005',
        airlineId: '22222222-2222-4222-a222-222222222222',
        aircraftId: 'c1111111-0000-4000-b000-000000000002',
        flightNumber: 'SQ-22',
        originAirportId: 'a1111111-0000-4000-a000-000000000004',
        destinationAirportId: 'a1111111-0000-4000-a000-000000000001',
        departureTime: new Date('2026-11-05T12:00:00Z'),
        arrivalTime: new Date('2026-11-06T06:00:00Z'),
        durationMinutes: 1080,
        status: 'SCHEDULED',
        basePrice: 85000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await searchService.handleKafkaEvent(
        createEvent(KAFKA_TOPICS.FLIGHT_CREATED, 'FlightCreated', 'admin-service', {
          flight: newFlight,
        })
      );

      const indexed = await searchService.getFlightById('flt-search-005');
      assert.ok(indexed);
      assert.strictEqual(indexed.flightNumber, 'SQ-22');
      assert.strictEqual(indexed.basePrice, 85000);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Search Service HTTP API Endpoints
  // ---------------------------------------------------------------------------
  describe('6. Search Service HTTP API Endpoints', () => {
    it('GET /api/search/flights should return flights matching route', async () => {
      const res = await fetch(`${baseUrl}/api/search/flights?origin=JFK&destination=LHR`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.total, 2);
      assert.ok(Array.isArray(body.data));
      assert.ok(body.facets);
    });

    it('GET /api/search/facets should return aggregated filters', async () => {
      const res = await fetch(`${baseUrl}/api/search/facets`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.ok(body.facets.airlines.length > 0);
      assert.ok(body.facets.priceRange.min > 0);
    });

    it('GET /api/search/flights/:flightId should return single flight', async () => {
      const res = await fetch(`${baseUrl}/api/search/flights/flt-search-001`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.flightNumber, 'EK-201');
    });

    it('GET /api/search/flights/:flightId should return 404 for non-existent flight', async () => {
      const res = await fetch(`${baseUrl}/api/search/flights/flt-unknown-999`);
      assert.strictEqual(res.status, 404);
    });
  });
});
