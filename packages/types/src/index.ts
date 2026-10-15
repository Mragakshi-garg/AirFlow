// ==========================================
// User & Authentication Types
// ==========================================
export type UserRole = 'USER' | 'ADMIN' | 'AIRLINE_ADMIN' | 'SUPPORT';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// ==========================================
// Airline, Airport & Aircraft Types
// ==========================================
export interface Airline {
  id: string;
  code: string; // IATA code, e.g. "AA", "DL", "AI"
  name: string;
  country: string;
  logoUrl?: string;
  createdAt: Date;
}

export interface Airport {
  id: string;
  code: string; // IATA code, e.g. "JFK", "DEL", "LHR"
  name: string;
  city: string;
  country: string;
  timezone: string;
  latitude: number;
  longitude: number;
  createdAt: Date;
}

export interface Aircraft {
  id: string;
  airlineId: string;
  model: string; // e.g. "Boeing 787-9", "Airbus A350-900"
  totalSeats: number;
  seatConfiguration: Record<string, any>;
  createdAt: Date;
}

// ==========================================
// Flight & Seat Inventory Types
// ==========================================
export type FlightStatus = 'SCHEDULED' | 'ACTIVE' | 'DELAYED' | 'CANCELLED' | 'LANDED';

export interface Flight {
  id: string;
  airlineId: string;
  aircraftId: string;
  flightNumber: string; // e.g. "AI-101"
  originAirportId: string;
  destinationAirportId: string;
  departureTime: Date;
  arrivalTime: Date;
  durationMinutes: number;
  status: FlightStatus;
  basePrice: number; // in cents or standard currency unit
  createdAt: Date;
  updatedAt: Date;
}

export type SeatClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';

export interface FlightSeat {
  id: string;
  flightId: string;
  seatNumber: string; // e.g. "12A", "01F"
  seatClass: SeatClass;
  price: number;
  status: SeatStatus;
  heldByUserId?: string | null;
  heldUntil?: Date | null;
  version: number; // Optimistic Concurrency Control version
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// Booking & Reservation Types
// ==========================================
export type BookingStatus = 
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'FAILED';

export interface Passenger {
  id?: string;
  bookingId?: string;
  firstName: string;
  lastName: string;
  passportNumber?: string;
  seatId: string;
  seatNumber: string;
}

export interface Booking {
  id: string;
  userId: string;
  flightId: string;
  seatId: string;
  totalAmount: number;
  currency: string;
  status: BookingStatus;
  bookingReference: string; // PNR, e.g. "X7K9PQ"
  expiresAt: Date; // Seat hold expiration
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// Payment Types
// ==========================================
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'CREDIT_CARD' | 'DEBIT_CARD' | 'UPI' | 'NET_BANKING' | 'WALLET';

export interface Payment {
  id: string;
  bookingId: string;
  userId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// Outbox & Idempotency Types (Saga & Reliable Messaging)
// ==========================================
export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEvent {
  id: string;
  aggregateType: string; // e.g. "BOOKING", "PAYMENT"
  aggregateId: string;
  eventType: string;     // e.g. "FlightBooked", "SeatHeld"
  payload: Record<string, any>;
  status: OutboxStatus;
  retryCount: number;
  createdAt: Date;
  processedAt?: Date | null;
}

export interface IdempotencyRecord {
  id: string;
  idempotencyKey: string;
  handlerName: string;
  responsePayload: Record<string, any>;
  statusCode: number;
  createdAt: Date;
}
