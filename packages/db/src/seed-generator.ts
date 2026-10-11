import {
  Airline,
  Airport,
  Aircraft,
  Flight,
  FlightSeat,
  SeatClass,
  SeatStatus,
  User,
  UserRole
} from '@airline/types';

// ==========================================
// Seed Data Catalogues
// ==========================================
export const SEED_AIRLINES: Omit<Airline, 'createdAt'>[] = [
  { id: '11111111-1111-4111-a111-111111111111', code: 'EK', name: 'Emirates', country: 'United Arab Emirates', logoUrl: 'https://assets.airline.com/ek.png' },
  { id: '22222222-2222-4222-a222-222222222222', code: 'SQ', name: 'Singapore Airlines', country: 'Singapore', logoUrl: 'https://assets.airline.com/sq.png' },
  { id: '33333333-3333-4333-a333-333333333333', code: 'BA', name: 'British Airways', country: 'United Kingdom', logoUrl: 'https://assets.airline.com/ba.png' },
  { id: '44444444-4444-4444-a444-444444444444', code: 'DL', name: 'Delta Air Lines', country: 'United States', logoUrl: 'https://assets.airline.com/dl.png' },
  { id: '55555555-5555-4555-a555-555555555555', code: 'AI', name: 'Air India', country: 'India', logoUrl: 'https://assets.airline.com/ai.png' },
  { id: '66666666-6666-4666-a666-666666666666', code: 'LH', name: 'Lufthansa', country: 'Germany', logoUrl: 'https://assets.airline.com/lh.png' },
  { id: '77777777-7777-4777-a777-777777777777', code: 'QR', name: 'Qatar Airways', country: 'Qatar', logoUrl: 'https://assets.airline.com/qr.png' },
  { id: '88888888-8888-4888-a888-888888888888', code: 'AA', name: 'American Airlines', country: 'United States', logoUrl: 'https://assets.airline.com/aa.png' },
];

export const SEED_AIRPORTS: Omit<Airport, 'createdAt'>[] = [
  { id: 'a1111111-0000-4000-a000-000000000001', code: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'United States', timezone: 'America/New_York', latitude: 40.6413, longitude: -73.7781 },
  { id: 'a1111111-0000-4000-a000-000000000002', code: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'United Kingdom', timezone: 'Europe/London', latitude: 51.4700, longitude: -0.4543 },
  { id: 'a1111111-0000-4000-a000-000000000003', code: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'United Arab Emirates', timezone: 'Asia/Dubai', latitude: 25.2532, longitude: 55.3657 },
  { id: 'a1111111-0000-4000-a000-000000000004', code: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', country: 'Singapore', timezone: 'Asia/Singapore', latitude: 1.3644, longitude: 103.9915 },
  { id: 'a1111111-0000-4000-a000-000000000005', code: 'DEL', name: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'India', timezone: 'Asia/Kolkata', latitude: 28.5562, longitude: 77.1000 },
  { id: 'a1111111-0000-4000-a000-000000000006', code: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France', timezone: 'Europe/Paris', latitude: 49.0097, longitude: 2.5479 },
  { id: 'a1111111-0000-4000-a000-000000000007', code: 'HND', name: 'Tokyo Haneda Airport', city: 'Tokyo', country: 'Japan', timezone: 'Asia/Tokyo', latitude: 35.5494, longitude: 139.7798 },
  { id: 'a1111111-0000-4000-a000-000000000008', code: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', timezone: 'Europe/Berlin', latitude: 50.0379, longitude: 8.5622 },
  { id: 'a1111111-0000-4000-a000-000000000009', code: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'United States', timezone: 'America/Los_Angeles', latitude: 33.9416, longitude: -118.4085 },
  { id: 'a1111111-0000-4000-a000-000000000010', code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', country: 'India', timezone: 'Asia/Kolkata', latitude: 19.0896, longitude: 72.8656 },
];

export const SEED_AIRCRAFTS: Omit<Aircraft, 'createdAt'>[] = [
  { id: 'c1111111-0000-4000-b000-000000000001', airlineId: '11111111-1111-4111-a111-111111111111', model: 'Boeing 777-300ER', totalSeats: 354, seatConfiguration: { first: 8, business: 42, economy: 304 } },
  { id: 'c1111111-0000-4000-b000-000000000002', airlineId: '22222222-2222-4222-a222-222222222222', model: 'Airbus A350-900', totalSeats: 253, seatConfiguration: { business: 42, premium_economy: 24, economy: 187 } },
  { id: 'c1111111-0000-4000-b000-000000000003', airlineId: '33333333-3333-4333-a333-333333333333', model: 'Boeing 787-9 Dreamliner', totalSeats: 216, seatConfiguration: { first: 8, business: 42, premium_economy: 39, economy: 127 } },
  { id: 'c1111111-0000-4000-b000-000000000004', airlineId: '44444444-4444-4444-a444-444444444444', model: 'Airbus A321neo', totalSeats: 194, seatConfiguration: { first: 20, economy: 174 } },
  { id: 'c1111111-0000-4000-b000-000000000005', airlineId: '55555555-5555-4555-a555-555555555555', model: 'Boeing 787-8', totalSeats: 256, seatConfiguration: { business: 18, economy: 238 } },
];

export const SEED_USERS: Omit<User, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'u1111111-0000-4000-c000-000000000001',
    email: 'admin@airline.com',
    passwordHash: '$2a$10$wK1k6VdY6X0sWfM2sQ8ZheYjNn6I6aR3tL4yK2pU7oI9gM1eW3xZ.', // 'AdminSecret123!'
    firstName: 'System',
    lastName: 'Admin',
    role: 'ADMIN' as UserRole,
    isActive: true,
  },
  {
    id: 'u1111111-0000-4000-c000-000000000002',
    email: 'ops@airline.com',
    passwordHash: '$2a$10$wK1k6VdY6X0sWfM2sQ8ZheYjNn6I6aR3tL4yK2pU7oI9gM1eW3xZ.',
    firstName: 'Flight',
    lastName: 'Operations',
    role: 'AIRLINE_ADMIN' as UserRole,
    isActive: true,
  },
  {
    id: 'u1111111-0000-4000-c000-000000000003',
    email: 'support@airline.com',
    passwordHash: '$2a$10$wK1k6VdY6X0sWfM2sQ8ZheYjNn6I6aR3tL4yK2pU7oI9gM1eW3xZ.',
    firstName: 'Customer',
    lastName: 'Support',
    role: 'SUPPORT' as UserRole,
    isActive: true,
  },
  {
    id: 'u1111111-0000-4000-c000-000000000004',
    email: 'passenger@example.com',
    passwordHash: '$2a$10$wK1k6VdY6X0sWfM2sQ8ZheYjNn6I6aR3tL4yK2pU7oI9gM1eW3xZ.',
    firstName: 'Alex',
    lastName: 'Morgan',
    role: 'USER' as UserRole,
    isActive: true,
  },
];

// ==========================================
// Generator Functions
// ==========================================

export interface GeneratedDataset {
  airlines: Airline[];
  airports: Airport[];
  aircrafts: Aircraft[];
  users: User[];
  flights: Flight[];
  flightSeats: FlightSeat[];
}

/**
 * Generates a standard seat inventory for a given flight.
 * Each flight receives realistic seat rows across First, Business, and Economy classes.
 * Each seat starts with version = 1 for Optimistic Concurrency Control.
 */
export function generateSeatsForFlight(
  flightId: string,
  basePrice: number,
  rowCount: number = 25
): FlightSeat[] {
  const seats: FlightSeat[] = [];
  const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const now = new Date();

  for (let row = 1; row <= rowCount; row++) {
    let seatClass: SeatClass = 'ECONOMY';
    let priceMultiplier = 1.0;

    if (row <= 2) {
      seatClass = 'FIRST';
      priceMultiplier = 4.0;
    } else if (row <= 6) {
      seatClass = 'BUSINESS';
      priceMultiplier = 2.5;
    } else if (row <= 10) {
      seatClass = 'PREMIUM_ECONOMY';
      priceMultiplier = 1.5;
    }

    const rowLetters = seatClass === 'FIRST' ? ['A', 'D', 'F'] : seatLetters;

    for (const letter of rowLetters) {
      const seatNumber = `${row.toString().padStart(2, '0')}${letter}`;
      seats.push({
        id: `seat-${flightId}-${seatNumber}`,
        flightId,
        seatNumber,
        seatClass,
        price: Math.round(basePrice * priceMultiplier),
        status: 'AVAILABLE' as SeatStatus,
        heldByUserId: null,
        heldUntil: null,
        version: 1, // Optimistic Concurrency Control
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return seats;
}

/**
 * Generates 1,000+ realistic flights across major routes over the next 30 days.
 */
export function generateFlights(targetCount: number = 1000): { flights: Flight[]; flightSeats: FlightSeat[] } {
  const flights: Flight[] = [];
  const allSeats: FlightSeat[] = [];
  const now = new Date();

  let flightIndex = 0;
  const daysHorizon = 30;

  // Approximate duration in minutes between airports
  const routeDurations: Record<string, number> = {
    'JFK-LHR': 420,
    'LHR-JFK': 450,
    'DXB-LHR': 460,
    'LHR-DXB': 430,
    'SIN-LHR': 840,
    'DEL-LHR': 540,
    'LHR-DEL': 510,
    'DEL-DXB': 220,
    'DXB-DEL': 200,
    'JFK-LAX': 360,
    'LAX-JFK': 330,
    'FRA-JFK': 520,
    'CDG-DXB': 400,
    'HND-SIN': 420,
    'BOM-DXB': 190,
  };

  const airportPairs: [Airport, Airport][] = [];
  for (const origin of SEED_AIRPORTS) {
    for (const dest of SEED_AIRPORTS) {
      if (origin.id !== dest.id) {
        airportPairs.push([origin as Airport, dest as Airport]);
      }
    }
  }

  while (flights.length < targetCount) {
    for (const [origin, dest] of airportPairs) {
      if (flights.length >= targetCount) break;

      const airline = SEED_AIRLINES[flightIndex % SEED_AIRLINES.length];
      const aircraft = SEED_AIRCRAFTS[flightIndex % SEED_AIRCRAFTS.length];

      // Schedule departure across the 30 day horizon
      const dayOffset = (flightIndex % daysHorizon) + 1;
      const hourOffset = (flightIndex * 3) % 24;
      const departureTime = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000 + hourOffset * 60 * 60 * 1000);

      const routeKey = `${origin.code}-${dest.code}`;
      const durationMinutes = routeDurations[routeKey] || (180 + ((flightIndex * 17) % 360));
      const arrivalTime = new Date(departureTime.getTime() + durationMinutes * 60 * 1000);

      // Base fare in cents (e.g., $150 to $850)
      const basePrice = Math.round((15000 + durationMinutes * 65) / 100) * 100;

      const flightNumber = `${airline.code}-${100 + (flightIndex % 900)}`;
      const flightId = `flt-${flightIndex.toString().padStart(6, '0')}`;

      const flight: Flight = {
        id: flightId,
        airlineId: airline.id,
        aircraftId: aircraft.id,
        flightNumber,
        originAirportId: origin.id,
        destinationAirportId: dest.id,
        departureTime,
        arrivalTime,
        durationMinutes,
        status: 'SCHEDULED',
        basePrice,
        createdAt: now,
        updatedAt: now,
      };

      flights.push(flight);

      // Generate seats for first 100 flights directly (keeps memory/perf optimal for full dataset,
      // while providing thousands of seats for inventory & concurrency testing)
      if (flights.length <= 100) {
        const seats = generateSeatsForFlight(flightId, basePrice, 15);
        allSeats.push(...seats);
      }

      flightIndex++;
    }
  }

  return { flights, flightSeats: allSeats };
}

/**
 * Returns the complete generated dataset for seeder execution.
 */
export function generateFullDataset(flightTarget: number = 1000): GeneratedDataset {
  const { flights, flightSeats } = generateFlights(flightTarget);
  const now = new Date();

  return {
    airlines: SEED_AIRLINES.map((a) => ({ ...a, createdAt: now })),
    airports: SEED_AIRPORTS.map((a) => ({ ...a, createdAt: now })),
    aircrafts: SEED_AIRCRAFTS.map((a) => ({ ...a, createdAt: now })),
    users: SEED_USERS.map((u) => ({ ...u, createdAt: now, updatedAt: now })),
    flights,
    flightSeats,
  };
}
