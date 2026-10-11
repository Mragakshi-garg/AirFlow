import { Booking, Flight, FlightSeat, Payment } from '@airline/types';

// ==========================================
// Kafka Topic Constants
// ==========================================
export const KAFKA_TOPICS = {
  // Flight & Inventory Topics
  FLIGHT_CREATED: 'airline.flight.created',
  FLIGHT_UPDATED: 'airline.flight.updated',
  FLIGHT_DELAYED: 'airline.flight.delayed',
  SEAT_HELD: 'airline.inventory.seat.held',
  SEAT_RELEASED: 'airline.inventory.seat.released',
  SEAT_BOOKED: 'airline.inventory.seat.booked',

  // Booking Topics (Saga Flow)
  BOOKING_CREATED: 'airline.booking.created',
  BOOKING_CONFIRMED: 'airline.booking.confirmed',
  BOOKING_CANCELLED: 'airline.booking.cancelled',
  BOOKING_EXPIRED: 'airline.booking.expired',

  // Payment Topics
  PAYMENT_PENDING: 'airline.payment.pending',
  PAYMENT_SUCCESS: 'airline.payment.success',
  PAYMENT_FAILED: 'airline.payment.failed',

  // Notification Topics
  NOTIFICATION_EMAIL: 'airline.notification.email',
  NOTIFICATION_SMS: 'airline.notification.sms',

  // Dead Letter Queue
  DEAD_LETTER_QUEUE: 'airline.events.dlq',
} as const;

export type KafkaTopic = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];

// ==========================================
// Base Event Envelope
// ==========================================
export interface EventEnvelope<T = any> {
  eventId: string;
  eventType: string;
  topic: KafkaTopic;
  timestamp: string; // ISO 8601
  correlationId: string;
  sourceService: string;
  payload: T;
}

// ==========================================
// Typed Event Payloads
// ==========================================
export interface FlightCreatedPayload {
  flight: Flight;
}

export interface FlightDelayedPayload {
  flightId: string;
  flightNumber: string;
  originalDepartureTime: string;
  newDepartureTime: string;
  delayReason?: string;
}

export interface SeatHeldPayload {
  flightId: string;
  seatId: string;
  seatNumber: string;
  userId: string;
  heldUntil: string;
  price: number;
}

export interface SeatReleasedPayload {
  flightId: string;
  seatId: string;
  seatNumber: string;
  reason: 'TIMEOUT' | 'USER_CANCELLED' | 'PAYMENT_FAILED';
}

export interface BookingCreatedPayload {
  booking: Booking;
  seat: FlightSeat;
}

export interface BookingConfirmedPayload {
  bookingId: string;
  bookingReference: string;
  userId: string;
  flightId: string;
  seatId: string;
  paymentId: string;
}

export interface BookingCancelledPayload {
  bookingId: string;
  bookingReference: string;
  reason: string;
}

export interface PaymentSuccessPayload {
  payment: Payment;
  bookingId: string;
  amount: number;
  transactionId: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  bookingId: string;
  userId: string;
  reason: string;
}

// ==========================================
// Helper Factory for Creating Events
// ==========================================
export function createEvent<T>(
  topic: KafkaTopic,
  eventType: string,
  sourceService: string,
  payload: T,
  correlationId?: string
): EventEnvelope<T> {
  return {
    eventId: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    eventType,
    topic,
    timestamp: new Date().toISOString(),
    correlationId: correlationId || `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    sourceService,
    payload,
  };
}
