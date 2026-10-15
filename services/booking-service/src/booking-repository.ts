import { Booking, BookingStatus, Passenger, OutboxEvent, IdempotencyRecord } from '@airline/types';

export interface BookingWithPassengers extends Booking {
  passengers: Passenger[];
}

export interface BookingRepository {
  createBookingWithOutbox(
    booking: Booking,
    passengers: Passenger[],
    outboxEvent: OutboxEvent
  ): Promise<{ booking: Booking; passengers: Passenger[]; outboxEvent: OutboxEvent }>;

  getBookingById(id: string): Promise<BookingWithPassengers | null>;
  getBookingByReference(pnr: string): Promise<BookingWithPassengers | null>;
  getBookingsByUserId(userId: string): Promise<BookingWithPassengers[]>;
  updateBookingStatus(id: string, status: BookingStatus): Promise<Booking | null>;

  saveOutboxEvent(event: OutboxEvent): Promise<OutboxEvent>;
  getPendingOutboxEvents(limit?: number): Promise<OutboxEvent[]>;
  markOutboxEventPublished(id: string): Promise<void>;
  markOutboxEventFailed(id: string, errorMessage?: string): Promise<void>;

  getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null>;
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void>;

  clear(): Promise<void>;
}

export class InMemoryBookingRepository implements BookingRepository {
  private bookings: Map<string, Booking> = new Map();
  private passengers: Map<string, Passenger[]> = new Map(); // bookingId -> Passenger[]
  private outbox: Map<string, OutboxEvent> = new Map();
  private idempotencyStore: Map<string, IdempotencyRecord> = new Map();

  async createBookingWithOutbox(
    booking: Booking,
    passengers: Passenger[],
    outboxEvent: OutboxEvent
  ): Promise<{ booking: Booking; passengers: Passenger[]; outboxEvent: OutboxEvent }> {
    const bookingCopy: Booking = {
      ...booking,
      createdAt: new Date(booking.createdAt || Date.now()),
      updatedAt: new Date(booking.updatedAt || Date.now()),
      expiresAt: new Date(booking.expiresAt),
    };

    const passengerCopies = passengers.map((p) => ({
      ...p,
      id: p.id || `psg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      bookingId: bookingCopy.id,
    }));

    const eventCopy: OutboxEvent = {
      ...outboxEvent,
      createdAt: new Date(outboxEvent.createdAt || Date.now()),
      status: 'PENDING',
      retryCount: 0,
    };

    this.bookings.set(bookingCopy.id, bookingCopy);
    this.passengers.set(bookingCopy.id, passengerCopies);
    this.outbox.set(eventCopy.id, eventCopy);

    return {
      booking: { ...bookingCopy },
      passengers: passengerCopies.map((p) => ({ ...p })),
      outboxEvent: { ...eventCopy },
    };
  }

  async getBookingById(id: string): Promise<BookingWithPassengers | null> {
    const booking = this.bookings.get(id);
    if (!booking) return null;

    const psg = this.passengers.get(id) || [];
    return {
      ...booking,
      passengers: psg.map((p) => ({ ...p })),
    };
  }

  async getBookingByReference(pnr: string): Promise<BookingWithPassengers | null> {
    const pnrUpper = pnr.trim().toUpperCase();
    for (const booking of this.bookings.values()) {
      if (booking.bookingReference.toUpperCase() === pnrUpper) {
        const psg = this.passengers.get(booking.id) || [];
        return {
          ...booking,
          passengers: psg.map((p) => ({ ...p })),
        };
      }
    }
    return null;
  }

  async getBookingsByUserId(userId: string): Promise<BookingWithPassengers[]> {
    const result: BookingWithPassengers[] = [];
    for (const booking of this.bookings.values()) {
      if (booking.userId === userId) {
        const psg = this.passengers.get(booking.id) || [];
        result.push({
          ...booking,
          passengers: psg.map((p) => ({ ...p })),
        });
      }
    }
    return result;
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<Booking | null> {
    const booking = this.bookings.get(id);
    if (!booking) return null;

    booking.status = status;
    booking.updatedAt = new Date();
    this.bookings.set(id, booking);

    return { ...booking };
  }

  async saveOutboxEvent(event: OutboxEvent): Promise<OutboxEvent> {
    const copy: OutboxEvent = {
      ...event,
      createdAt: new Date(event.createdAt || Date.now()),
    };
    this.outbox.set(copy.id, copy);
    return { ...copy };
  }

  async getPendingOutboxEvents(limit: number = 50): Promise<OutboxEvent[]> {
    return Array.from(this.outbox.values())
      .filter((e) => e.status === 'PENDING')
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async markOutboxEventPublished(id: string): Promise<void> {
    const event = this.outbox.get(id);
    if (event) {
      event.status = 'PUBLISHED';
      event.processedAt = new Date();
      this.outbox.set(id, event);
    }
  }

  async markOutboxEventFailed(id: string, _errorMessage?: string): Promise<void> {
    const event = this.outbox.get(id);
    if (event) {
      event.retryCount += 1;
      if (event.retryCount >= 5) {
        event.status = 'FAILED';
      }
      this.outbox.set(id, event);
    }
  }

  async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const record = this.idempotencyStore.get(key);
    return record ? { ...record } : null;
  }

  async saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotencyStore.set(record.idempotencyKey, { ...record });
  }

  async clear(): Promise<void> {
    this.bookings.clear();
    this.passengers.clear();
    this.outbox.clear();
    this.idempotencyStore.clear();
  }
}
