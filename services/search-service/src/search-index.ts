import { FlightStatus } from '@airline/types';
import { createLogger } from '@airline/logger';

const logger = createLogger('search-index');

export interface FlightSearchDocument {
  id: string;
  flightNumber: string;
  airlineId: string;
  airlineCode: string;
  airlineName: string;
  originAirportId: string;
  originAirportCode: string;
  originAirportCity: string;
  destinationAirportId: string;
  destinationAirportCode: string;
  destinationAirportCity: string;
  departureTime: string; // ISO 8601 string
  arrivalTime: string;   // ISO 8601 string
  durationMinutes: number;
  status: FlightStatus;
  basePrice: number;     // in cents
  availableSeatsCount: number;
}

export interface FlightSearchQuery {
  origin?: string;        // airport code or city (e.g., "JFK", "DEL", "New York")
  destination?: string;   // airport code or city (e.g., "LHR", "London")
  departureDate?: string; // YYYY-MM-DD
  airlineCode?: string;   // e.g., "EK", "SQ", "AI"
  minPrice?: number;
  maxPrice?: number;
  status?: FlightStatus;
  sortBy?: 'price_asc' | 'price_desc' | 'duration_asc' | 'departure_asc';
  limit?: number;
  offset?: number;
}

export interface AirlineFacet {
  code: string;
  name: string;
  count: number;
  minPrice: number;
}

export interface SearchFacets {
  totalMatching: number;
  airlines: AirlineFacet[];
  priceRange: {
    min: number;
    max: number;
    avg: number;
  };
}

export interface SearchResult {
  data: FlightSearchDocument[];
  facets: SearchFacets;
  total: number;
  limit: number;
  offset: number;
}

export interface SearchIndex {
  indexFlight(doc: FlightSearchDocument): Promise<void>;
  bulkIndexFlights(docs: FlightSearchDocument[]): Promise<number>;
  getFlightById(id: string): Promise<FlightSearchDocument | null>;
  search(query: FlightSearchQuery): Promise<SearchResult>;
  getFacets(query?: FlightSearchQuery): Promise<SearchFacets>;
  updateFlightStatus(
    flightId: string,
    status: FlightStatus,
    newDepartureTime?: string,
    newArrivalTime?: string
  ): Promise<boolean>;
  updateAvailableSeats(flightId: string, delta: number): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * High-performance In-Memory Faceted Search Index
 * Implements Elasticsearch-compatible faceted search, multi-field text matching, and range filters.
 */
export class InMemorySearchIndex implements SearchIndex {
  private documents: Map<string, FlightSearchDocument> = new Map();

  async indexFlight(doc: FlightSearchDocument): Promise<void> {
    this.documents.set(doc.id, { ...doc });
  }

  async bulkIndexFlights(docs: FlightSearchDocument[]): Promise<number> {
    for (const doc of docs) {
      this.documents.set(doc.id, { ...doc });
    }
    logger.info(`Bulk indexed ${docs.length} flights into search index`);
    return docs.length;
  }

  async getFlightById(id: string): Promise<FlightSearchDocument | null> {
    const doc = this.documents.get(id);
    return doc ? { ...doc } : null;
  }

  async search(query: FlightSearchQuery): Promise<SearchResult> {
    let filtered = Array.from(this.documents.values());

    // 1. Origin match (Code or City, case-insensitive)
    if (query.origin) {
      const orig = query.origin.trim().toUpperCase();
      filtered = filtered.filter(
        (f) =>
          f.originAirportCode.toUpperCase() === orig ||
          f.originAirportCity.toUpperCase().includes(orig) ||
          f.originAirportId === query.origin
      );
    }

    // 2. Destination match (Code or City, case-insensitive)
    if (query.destination) {
      const dest = query.destination.trim().toUpperCase();
      filtered = filtered.filter(
        (f) =>
          f.destinationAirportCode.toUpperCase() === dest ||
          f.destinationAirportCity.toUpperCase().includes(dest) ||
          f.destinationAirportId === query.destination
      );
    }

    // 3. Departure Date match (YYYY-MM-DD prefix check)
    if (query.departureDate) {
      const targetDate = query.departureDate.trim(); // e.g., "2026-10-20"
      filtered = filtered.filter((f) => f.departureTime.startsWith(targetDate));
    }

    // 4. Airline Code filter
    if (query.airlineCode) {
      const code = query.airlineCode.trim().toUpperCase();
      filtered = filtered.filter((f) => f.airlineCode.toUpperCase() === code);
    }

    // 5. Price Range
    if (query.minPrice !== undefined) {
      filtered = filtered.filter((f) => f.basePrice >= query.minPrice!);
    }
    if (query.maxPrice !== undefined) {
      filtered = filtered.filter((f) => f.basePrice <= query.maxPrice!);
    }

    // 6. Status filter
    if (query.status) {
      filtered = filtered.filter((f) => f.status === query.status);
    }

    // Compute facets over ALL matching items before pagination
    const facets = this.computeFacets(filtered);
    const total = filtered.length;

    // 7. Sorting
    const sortBy = query.sortBy || 'price_asc';
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.basePrice - b.basePrice;
        case 'price_desc':
          return b.basePrice - a.basePrice;
        case 'duration_asc':
          return a.durationMinutes - b.durationMinutes;
        case 'departure_asc':
          return new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime();
        default:
          return 0;
      }
    });

    // 8. Pagination
    const limit = query.limit || 20;
    const offset = query.offset || 0;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      data: paginated,
      facets,
      total,
      limit,
      offset,
    };
  }

  async getFacets(query?: FlightSearchQuery): Promise<SearchFacets> {
    const res = await this.search({ ...(query || {}), limit: 100000, offset: 0 });
    return res.facets;
  }

  async updateFlightStatus(
    flightId: string,
    status: FlightStatus,
    newDepartureTime?: string,
    newArrivalTime?: string
  ): Promise<boolean> {
    const doc = this.documents.get(flightId);
    if (!doc) return false;

    doc.status = status;
    if (newDepartureTime) doc.departureTime = newDepartureTime;
    if (newArrivalTime) doc.arrivalTime = newArrivalTime;

    this.documents.set(flightId, doc);
    return true;
  }

  async updateAvailableSeats(flightId: string, delta: number): Promise<boolean> {
    const doc = this.documents.get(flightId);
    if (!doc) return false;

    doc.availableSeatsCount = Math.max(0, doc.availableSeatsCount + delta);
    this.documents.set(flightId, doc);
    return true;
  }

  async count(): Promise<number> {
    return this.documents.size;
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }

  private computeFacets(items: FlightSearchDocument[]): SearchFacets {
    if (items.length === 0) {
      return {
        totalMatching: 0,
        airlines: [],
        priceRange: { min: 0, max: 0, avg: 0 },
      };
    }

    const airlineMap = new Map<string, { name: string; count: number; minPrice: number }>();
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let totalPrice = 0;

    for (const item of items) {
      // Airline facet
      const existing = airlineMap.get(item.airlineCode);
      if (existing) {
        existing.count++;
        existing.minPrice = Math.min(existing.minPrice, item.basePrice);
      } else {
        airlineMap.set(item.airlineCode, {
          name: item.airlineName,
          count: 1,
          minPrice: item.basePrice,
        });
      }

      // Price stats
      minPrice = Math.min(minPrice, item.basePrice);
      maxPrice = Math.max(maxPrice, item.basePrice);
      totalPrice += item.basePrice;
    }

    const airlines: AirlineFacet[] = Array.from(airlineMap.entries()).map(([code, data]) => ({
      code,
      name: data.name,
      count: data.count,
      minPrice: data.minPrice,
    }));

    airlines.sort((a, b) => b.count - a.count);

    return {
      totalMatching: items.length,
      airlines,
      priceRange: {
        min: minPrice === Infinity ? 0 : minPrice,
        max: maxPrice === -Infinity ? 0 : maxPrice,
        avg: Math.round(totalPrice / items.length),
      },
    };
  }
}
