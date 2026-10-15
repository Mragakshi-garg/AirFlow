import { EventEnvelope, KAFKA_TOPICS } from '@airline/events';
import { Airline, Airport, Flight, FlightStatus } from '@airline/types';
import { createLogger } from '@airline/logger';
import {
  FlightSearchDocument,
  FlightSearchQuery,
  SearchFacets,
  SearchIndex,
  SearchResult,
} from './search-index';
import { SearchCacheService } from './cache-service';

const logger = createLogger('flight-search-service');

export interface SearchFlightsResponse extends SearchResult {
  cached: boolean;
}

export class FlightSearchService {
  constructor(
    private index: SearchIndex,
    private cache: SearchCacheService
  ) {}

  /**
   * Search flights with Redis Cache-Aside & Singleflight request coalescing.
   */
  async search(query: FlightSearchQuery): Promise<SearchFlightsResponse> {
    const cacheKey = this.cache.generateCacheKey('search:flights', query as any);

    const { data, cached } = await this.cache.getOrSet(cacheKey, async () => {
      return this.index.search(query);
    });

    return {
      ...data,
      cached,
    };
  }

  /**
   * Get search facets / aggregations (with caching).
   */
  async getFacets(query?: FlightSearchQuery): Promise<SearchFacets> {
    const cacheKey = this.cache.generateCacheKey('search:facets', (query || {}) as any);

    const { data } = await this.cache.getOrSet(cacheKey, async () => {
      return this.index.getFacets(query);
    });

    return data;
  }

  /**
   * Retrieve a single flight document.
   */
  async getFlightById(flightId: string): Promise<FlightSearchDocument | null> {
    return this.index.getFlightById(flightId);
  }

  /**
   * Index or update a single flight and invalidate cache.
   */
  async indexFlight(doc: FlightSearchDocument): Promise<void> {
    await this.index.indexFlight(doc);
    await this.cache.clearAll();
  }

  /**
   * Bulk index flights and invalidate cache.
   */
  async bulkIndexFlights(docs: FlightSearchDocument[]): Promise<number> {
    const count = await this.index.bulkIndexFlights(docs);
    await this.cache.clearAll();
    return count;
  }

  /**
   * Event-driven search index updates via Kafka events.
   */
  async handleKafkaEvent(event: EventEnvelope): Promise<void> {
    logger.debug('Handling Kafka event in Search Service', {
      topic: event.topic,
      eventType: event.eventType,
    });

    switch (event.topic) {
      case KAFKA_TOPICS.FLIGHT_DELAYED: {
        const payload = event.payload;
        await this.index.updateFlightStatus(
          payload.flightId,
          'DELAYED',
          payload.newDepartureTime,
          payload.newArrivalTime
        );
        await this.cache.clearAll();
        break;
      }

      case KAFKA_TOPICS.SEAT_HELD: {
        const payload = event.payload;
        await this.index.updateAvailableSeats(payload.flightId, -1);
        await this.cache.clearAll();
        break;
      }

      case KAFKA_TOPICS.SEAT_RELEASED: {
        const payload = event.payload;
        await this.index.updateAvailableSeats(payload.flightId, 1);
        await this.cache.clearAll();
        break;
      }

      case KAFKA_TOPICS.FLIGHT_CREATED: {
        const flight: Flight = event.payload.flight;
        if (flight) {
          // Construct minimal search document if airports/airlines are known
          const doc: FlightSearchDocument = {
            id: flight.id,
            flightNumber: flight.flightNumber,
            airlineId: flight.airlineId,
            airlineCode: flight.flightNumber.split('-')[0] || 'AI',
            airlineName: 'Partner Airline',
            originAirportId: flight.originAirportId,
            originAirportCode: 'ORIG',
            originAirportCity: 'Origin City',
            destinationAirportId: flight.destinationAirportId,
            destinationAirportCode: 'DEST',
            destinationAirportCity: 'Destination City',
            departureTime: new Date(flight.departureTime).toISOString(),
            arrivalTime: new Date(flight.arrivalTime).toISOString(),
            durationMinutes: flight.durationMinutes,
            status: flight.status as FlightStatus,
            basePrice: flight.basePrice,
            availableSeatsCount: 150,
          };
          await this.index.indexFlight(doc);
          await this.cache.clearAll();
        }
        break;
      }

      default:
        // Other events ignored
        break;
    }
  }

  /**
   * Helper to transform relational entities into denormalized search documents.
   */
  static buildSearchDocument(
    flight: Flight,
    airline: Airline,
    originAirport: Airport,
    destinationAirport: Airport,
    availableSeatsCount: number = 180
  ): FlightSearchDocument {
    return {
      id: flight.id,
      flightNumber: flight.flightNumber,
      airlineId: airline.id,
      airlineCode: airline.code,
      airlineName: airline.name,
      originAirportId: originAirport.id,
      originAirportCode: originAirport.code,
      originAirportCity: originAirport.city,
      destinationAirportId: destinationAirport.id,
      destinationAirportCode: destinationAirport.code,
      destinationAirportCity: destinationAirport.city,
      departureTime: new Date(flight.departureTime).toISOString(),
      arrivalTime: new Date(flight.arrivalTime).toISOString(),
      durationMinutes: flight.durationMinutes,
      status: flight.status as FlightStatus,
      basePrice: flight.basePrice,
      availableSeatsCount,
    };
  }
}
