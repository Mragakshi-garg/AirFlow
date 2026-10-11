import { Request, Response } from 'express';
import { Airline, Flight, FlightSeat, FlightStatus } from '@airline/types';
import { SEED_AIRLINES, generateSeatsForFlight } from '@airline/db';

export interface AdminRepository {
  // Airlines
  getAllAirlines(): Promise<Airline[]>;
  getAirlineById(id: string): Promise<Airline | null>;
  createAirline(airline: Omit<Airline, 'createdAt'>): Promise<Airline>;
  updateAirline(id: string, updates: Partial<Airline>): Promise<Airline | null>;
  deleteAirline(id: string): Promise<boolean>;

  // Flights
  getAllFlights(limit?: number): Promise<Flight[]>;
  getFlightById(id: string): Promise<Flight | null>;
  createFlight(flight: Omit<Flight, 'createdAt' | 'updatedAt'>): Promise<Flight>;
  updateFlightStatus(id: string, status: FlightStatus): Promise<Flight | null>;

  // Seats & Inventory
  getSeatsByFlightId(flightId: string): Promise<FlightSeat[]>;
  saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]>;
}

export class InMemoryAdminRepository implements AdminRepository {
  private airlines: Map<string, Airline> = new Map();
  private flights: Map<string, Flight> = new Map();
  private seats: Map<string, FlightSeat[]> = new Map();

  constructor() {
    const now = new Date();
    for (const a of SEED_AIRLINES) {
      this.airlines.set(a.id, { ...a, createdAt: now });
    }
  }

  async getAllAirlines(): Promise<Airline[]> {
    return Array.from(this.airlines.values());
  }

  async getAirlineById(id: string): Promise<Airline | null> {
    return this.airlines.get(id) || null;
  }

  async createAirline(data: Omit<Airline, 'createdAt'>): Promise<Airline> {
    const airline: Airline = { ...data, createdAt: new Date() };
    this.airlines.set(airline.id, airline);
    return airline;
  }

  async updateAirline(id: string, updates: Partial<Airline>): Promise<Airline | null> {
    const existing = this.airlines.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.airlines.set(id, updated);
    return updated;
  }

  async deleteAirline(id: string): Promise<boolean> {
    return this.airlines.delete(id);
  }

  async getAllFlights(limit: number = 50): Promise<Flight[]> {
    return Array.from(this.flights.values()).slice(0, limit);
  }

  async getFlightById(id: string): Promise<Flight | null> {
    return this.flights.get(id) || null;
  }

  async createFlight(data: Omit<Flight, 'createdAt' | 'updatedAt'>): Promise<Flight> {
    const now = new Date();
    const flight: Flight = { ...data, createdAt: now, updatedAt: now };
    this.flights.set(flight.id, flight);
    return flight;
  }

  async updateFlightStatus(id: string, status: FlightStatus): Promise<Flight | null> {
    const existing = this.flights.get(id);
    if (!existing) return null;
    const updated: Flight = { ...existing, status, updatedAt: new Date() };
    this.flights.set(id, updated);
    return updated;
  }

  async getSeatsByFlightId(flightId: string): Promise<FlightSeat[]> {
    return this.seats.get(flightId) || [];
  }

  async saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]> {
    if (seats.length === 0) return [];
    const flightId = seats[0].flightId;
    this.seats.set(flightId, seats);
    return seats;
  }
}

export class AdminController {
  constructor(private repo: AdminRepository) {}

  // ---------------------------------------------------------------------------
  // Airline Handlers
  // ---------------------------------------------------------------------------
  getAirlines = async (_req: Request, res: Response): Promise<void> => {
    const airlines = await this.repo.getAllAirlines();
    res.status(200).json({ count: airlines.length, data: airlines });
  };

  createAirline = async (req: Request, res: Response): Promise<void> => {
    const { code, name, country, logoUrl } = req.body;
    if (!code || !name || !country) {
      res.status(400).json({ error: 'Bad Request', message: 'Fields code, name, and country are required' });
      return;
    }

    const id = `air-${code.toLowerCase()}-${Date.now()}`;
    const newAirline = await this.repo.createAirline({ id, code, name, country, logoUrl });
    res.status(201).json({ message: 'Airline created successfully', data: newAirline });
  };

  updateAirline = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const updated = await this.repo.updateAirline(id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Not Found', message: `Airline ${id} not found` });
      return;
    }
    res.status(200).json({ message: 'Airline updated successfully', data: updated });
  };

  deleteAirline = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const deleted = await this.repo.deleteAirline(id);
    if (!deleted) {
      res.status(404).json({ error: 'Not Found', message: `Airline ${id} not found` });
      return;
    }
    res.status(204).send();
  };

  // ---------------------------------------------------------------------------
  // Flight Handlers
  // ---------------------------------------------------------------------------
  getFlights = async (req: Request, res: Response): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 50;
    const flights = await this.repo.getAllFlights(limit);
    res.status(200).json({ count: flights.length, data: flights });
  };

  createFlight = async (req: Request, res: Response): Promise<void> => {
    const {
      airlineId,
      aircraftId,
      flightNumber,
      originAirportId,
      destinationAirportId,
      departureTime,
      arrivalTime,
      durationMinutes,
      basePrice,
    } = req.body;

    if (!airlineId || !aircraftId || !flightNumber || !originAirportId || !destinationAirportId || !departureTime) {
      res.status(400).json({ error: 'Bad Request', message: 'Missing required flight scheduling fields' });
      return;
    }

    const id = `flt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newFlight = await this.repo.createFlight({
      id,
      airlineId,
      aircraftId,
      flightNumber,
      originAirportId,
      destinationAirportId,
      departureTime: new Date(departureTime),
      arrivalTime: new Date(arrivalTime || Date.now() + (durationMinutes || 180) * 60000),
      durationMinutes: durationMinutes || 180,
      status: 'SCHEDULED',
      basePrice: basePrice || 20000,
    });

    res.status(201).json({ message: 'Flight scheduled successfully', data: newFlight });
  };

  updateFlightStatus = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const { status } = req.body;

    const validStatuses: FlightStatus[] = ['SCHEDULED', 'ACTIVE', 'DELAYED', 'CANCELLED', 'LANDED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Bad Request', message: `Invalid status. Must be one of: [${validStatuses.join(', ')}]` });
      return;
    }

    const updated = await this.repo.updateFlightStatus(id, status);
    if (!updated) {
      res.status(404).json({ error: 'Not Found', message: `Flight ${id} not found` });
      return;
    }
    res.status(200).json({ message: 'Flight status updated successfully', data: updated });
  };

  // ---------------------------------------------------------------------------
  // Seat Inventory Handlers
  // ---------------------------------------------------------------------------
  getFlightSeats = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const seats = await this.repo.getSeatsByFlightId(id);
    res.status(200).json({ flightId: id, totalSeats: seats.length, data: seats });
  };

  generateFlightSeats = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const { basePrice, rowCount } = req.body;

    const flight = await this.repo.getFlightById(id);
    const price = basePrice || flight?.basePrice || 25000;
    const rows = rowCount || 20;

    const seats = generateSeatsForFlight(id, price, rows);
    await this.repo.saveSeats(seats);

    res.status(201).json({
      message: `Generated ${seats.length} seats for flight ${id}`,
      flightId: id,
      seatCount: seats.length,
      data: seats,
    });
  };
}
