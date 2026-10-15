import { Request, Response } from 'express';
import { FlightSearchService } from './search-service';
import { FlightSearchQuery } from './search-index';
import { createLogger } from '@airline/logger';

const logger = createLogger('search-controller');

function getQueryParam(val: any): string | undefined {
  if (Array.isArray(val)) return val[0];
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

export class SearchController {
  constructor(private searchService: FlightSearchService) {}

  /**
   * GET /api/search/flights
   */
  searchFlights = async (req: Request, res: Response): Promise<void> => {
    try {
      const origin = getQueryParam(req.query.origin);
      const destination = getQueryParam(req.query.destination);
      const departureDate = getQueryParam(req.query.departureDate || req.query.date);
      const airlineCode = getQueryParam(req.query.airline || req.query.airlineCode);
      const sortBy = getQueryParam(req.query.sortBy) as any;

      const minPrice = req.query.minPrice ? parseInt(String(req.query.minPrice), 10) : undefined;
      const maxPrice = req.query.maxPrice ? parseInt(String(req.query.maxPrice), 10) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

      const query: FlightSearchQuery = {
        origin,
        destination,
        departureDate,
        airlineCode,
        minPrice,
        maxPrice,
        sortBy,
        limit,
        offset,
      };

      const result = await this.searchService.search(query);

      res.status(200).json({
        success: true,
        count: result.data.length,
        total: result.total,
        cached: result.cached,
        data: result.data,
        facets: result.facets,
        pagination: {
          limit: result.limit,
          offset: result.offset,
        },
      });
    } catch (err) {
      logger.error('Error during flight search', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * GET /api/search/facets
   */
  getFacets = async (req: Request, res: Response): Promise<void> => {
    try {
      const origin = getQueryParam(req.query.origin);
      const destination = getQueryParam(req.query.destination);

      const facets = await this.searchService.getFacets({ origin, destination });
      res.status(200).json({ success: true, facets });
    } catch (err) {
      logger.error('Error fetching search facets', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * GET /api/search/flights/:flightId
   */
  getFlightById = async (req: Request, res: Response): Promise<void> => {
    try {
      const flightId = Array.isArray(req.params.flightId) ? req.params.flightId[0] : req.params.flightId;
      const flight = await this.searchService.getFlightById(flightId);

      if (!flight) {
        res.status(404).json({ error: 'Not Found', message: `Flight ${flightId} not found in search index` });
        return;
      }

      res.status(200).json({ success: true, data: flight });
    } catch (err) {
      logger.error('Error fetching flight by ID', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * POST /api/search/sync
   */
  bulkSync = async (req: Request, res: Response): Promise<void> => {
    try {
      const docs = req.body.flights;
      if (!Array.isArray(docs)) {
        res.status(400).json({ error: 'Bad Request', message: 'Body must include an array of flights' });
        return;
      }

      const count = await this.searchService.bulkIndexFlights(docs);
      res.status(200).json({ message: 'Search index sync completed', indexedCount: count });
    } catch (err) {
      logger.error('Error during bulk search sync', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };
}
