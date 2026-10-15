import { FlightSeat, SeatStatus } from '@airline/types';
import { DatabaseClient, flightSeats } from '@airline/db';
import { eq, and, sql } from 'drizzle-orm';

export interface SeatUpdateResult {
  success: boolean;
  seat?: FlightSeat;
  conflict?: boolean;
  errorMessage?: string;
}

export interface InventoryRepository {
  getSeatsByFlightId(flightId: string): Promise<FlightSeat[]>;
  getSeatById(seatId: string): Promise<FlightSeat | null>;
  saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]>;
  updateSeatWithOCC(
    seatId: string,
    expectedVersion: number,
    updates: {
      status?: SeatStatus;
      heldByUserId?: string | null;
      heldUntil?: Date | null;
    }
  ): Promise<SeatUpdateResult>;
  withRowLock<T>(seatId: string, fn: (seat: FlightSeat) => Promise<T>): Promise<T>;
  releaseExpiredHolds(flightId?: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-Memory Repository (For Standalone, Unit Testing, and High-Throughput Benchmarks)
// ---------------------------------------------------------------------------
export class InMemoryInventoryRepository implements InventoryRepository {
  private seats: Map<string, FlightSeat> = new Map();
  // Per-seat mutex lock queue for Tier 3 pessimistic row-level locking simulation
  private seatLocks: Map<string, Promise<void>> = new Map();

  async getSeatsByFlightId(flightId: string): Promise<FlightSeat[]> {
    await this.releaseExpiredHolds(flightId);
    return Array.from(this.seats.values()).filter((s) => s.flightId === flightId);
  }

  async getSeatById(seatId: string): Promise<FlightSeat | null> {
    const seat = this.seats.get(seatId);
    if (!seat) return null;

    // Check for expired hold
    if (seat.status === 'HELD' && seat.heldUntil && new Date(seat.heldUntil).getTime() <= Date.now()) {
      seat.status = 'AVAILABLE';
      seat.heldByUserId = null;
      seat.heldUntil = null;
      seat.version += 1;
      seat.updatedAt = new Date();
    }

    return { ...seat };
  }

  async saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]> {
    for (const seat of seats) {
      this.seats.set(seat.id, { ...seat });
    }
    return seats;
  }

  /**
   * Tier 3: Pessimistic Row Lock simulation
   * Serializes operations on this specific seat row using a mutex chain
   */
  async withRowLock<T>(seatId: string, fn: (seat: FlightSeat) => Promise<T>): Promise<T> {
    const previousLock = this.seatLocks.get(seatId) || Promise.resolve();
    let releaseCurrentLock: () => void = () => {};

    const currentLock = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve;
    });

    this.seatLocks.set(seatId, currentLock);

    try {
      await previousLock;
      const seat = await this.getSeatById(seatId);
      if (!seat) {
        throw new Error(`Seat with ID ${seatId} not found`);
      }
      return await fn(seat);
    } finally {
      releaseCurrentLock();
      if (this.seatLocks.get(seatId) === currentLock) {
        this.seatLocks.delete(seatId);
      }
    }
  }

  /**
   * Tier 2: Optimistic Concurrency Control (OCC)
   * Updates the seat only if the current version matches expectedVersion
   */
  async updateSeatWithOCC(
    seatId: string,
    expectedVersion: number,
    updates: {
      status?: SeatStatus;
      heldByUserId?: string | null;
      heldUntil?: Date | null;
    }
  ): Promise<SeatUpdateResult> {
    const current = this.seats.get(seatId);
    if (!current) {
      return { success: false, conflict: false, errorMessage: 'Seat not found' };
    }

    // OCC Check: Version must match exactly
    if (current.version !== expectedVersion) {
      return {
        success: false,
        conflict: true,
        errorMessage: `OCC Conflict: Expected version ${expectedVersion}, but found ${current.version}`,
      };
    }

    const updatedSeat: FlightSeat = {
      ...current,
      status: updates.status ?? current.status,
      heldByUserId: updates.heldByUserId !== undefined ? updates.heldByUserId : current.heldByUserId,
      heldUntil: updates.heldUntil !== undefined ? updates.heldUntil : current.heldUntil,
      version: current.version + 1, // Increment OCC version
      updatedAt: new Date(),
    };

    this.seats.set(seatId, updatedSeat);
    return { success: true, seat: { ...updatedSeat } };
  }

  async releaseExpiredHolds(flightId?: string): Promise<number> {
    const now = Date.now();
    let releasedCount = 0;

    for (const seat of this.seats.values()) {
      if (flightId && seat.flightId !== flightId) continue;

      if (seat.status === 'HELD' && seat.heldUntil && new Date(seat.heldUntil).getTime() <= now) {
        seat.status = 'AVAILABLE';
        seat.heldByUserId = null;
        seat.heldUntil = null;
        seat.version += 1;
        seat.updatedAt = new Date();
        releasedCount++;
      }
    }

    return releasedCount;
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL Drizzle Repository (Production Implementation with Raw Row Locking)
// ---------------------------------------------------------------------------
export class PostgresInventoryRepository implements InventoryRepository {
  constructor(private dbClient: DatabaseClient) {}

  async getSeatsByFlightId(flightId: string): Promise<FlightSeat[]> {
    await this.releaseExpiredHolds(flightId);
    const results = await this.dbClient.db
      .select()
      .from(flightSeats)
      .where(eq(flightSeats.flightId, flightId));

    return results.map((r) => ({
      ...r,
      seatClass: r.seatClass as any,
      status: r.status as any,
    }));
  }

  async getSeatById(seatId: string): Promise<FlightSeat | null> {
    const results = await this.dbClient.db
      .select()
      .from(flightSeats)
      .where(eq(flightSeats.id, seatId))
      .limit(1);

    if (results.length === 0) return null;
    const r = results[0];

    // Lazy auto-expire check
    if (r.status === 'HELD' && r.heldUntil && new Date(r.heldUntil).getTime() <= Date.now()) {
      await this.dbClient.db
        .update(flightSeats)
        .set({
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
          version: sql`${flightSeats.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(flightSeats.id, seatId));

      return {
        ...r,
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: r.version + 1,
        seatClass: r.seatClass as any,
      };
    }

    return {
      ...r,
      seatClass: r.seatClass as any,
      status: r.status as any,
    };
  }

  async saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]> {
    if (seats.length === 0) return [];
    await this.dbClient.db.insert(flightSeats).values(
      seats.map((s) => ({
        id: s.id,
        flightId: s.flightId,
        seatNumber: s.seatNumber,
        seatClass: s.seatClass,
        price: s.price,
        status: s.status,
        heldByUserId: s.heldByUserId || null,
        heldUntil: s.heldUntil || null,
        version: s.version,
      }))
    );
    return seats;
  }

  /**
   * Tier 3: Pessimistic Row Lock (`SELECT ... FOR UPDATE`) inside a transaction
   */
  async withRowLock<T>(seatId: string, fn: (seat: FlightSeat) => Promise<T>): Promise<T> {
    const pool = this.dbClient.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Execute SELECT ... FOR UPDATE to lock the specific seat row
      const selectRes = await client.query(
        'SELECT * FROM flight_seats WHERE id = $1 FOR UPDATE',
        [seatId]
      );

      if (selectRes.rowCount === 0) {
        throw new Error(`Seat with ID ${seatId} not found`);
      }

      const row = selectRes.rows[0];
      const seat: FlightSeat = {
        id: row.id,
        flightId: row.flight_id,
        seatNumber: row.seat_number,
        seatClass: row.seat_class,
        price: row.price,
        status: row.status,
        heldByUserId: row.held_by_user_id,
        heldUntil: row.held_until ? new Date(row.held_until) : null,
        version: row.version,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };

      const result = await fn(seat);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Tier 2: Optimistic Concurrency Control (OCC)
   */
  async updateSeatWithOCC(
    seatId: string,
    expectedVersion: number,
    updates: {
      status?: SeatStatus;
      heldByUserId?: string | null;
      heldUntil?: Date | null;
    }
  ): Promise<SeatUpdateResult> {
    const updateValues: Record<string, any> = {
      version: sql`${flightSeats.version} + 1`,
      updatedAt: new Date(),
    };

    if (updates.status !== undefined) updateValues.status = updates.status;
    if (updates.heldByUserId !== undefined) updateValues.heldByUserId = updates.heldByUserId;
    if (updates.heldUntil !== undefined) updateValues.heldUntil = updates.heldUntil;

    const result = await this.dbClient.db
      .update(flightSeats)
      .set(updateValues)
      .where(and(eq(flightSeats.id, seatId), eq(flightSeats.version, expectedVersion)))
      .returning();

    if (result.length === 0) {
      // Check if seat exists to determine whether it's an OCC version conflict
      const existing = await this.getSeatById(seatId);
      if (!existing) {
        return { success: false, conflict: false, errorMessage: 'Seat not found' };
      }
      return {
        success: false,
        conflict: true,
        errorMessage: `OCC Conflict: Seat modified concurrently (current version: ${existing.version}, expected: ${expectedVersion})`,
      };
    }

    const updated = result[0];
    return {
      success: true,
      seat: {
        ...updated,
        seatClass: updated.seatClass as any,
        status: updated.status as any,
      },
    };
  }

  async releaseExpiredHolds(flightId?: string): Promise<number> {
    const now = new Date();
    const condition = flightId
      ? sql`status = 'HELD' AND held_until <= ${now} AND flight_id = ${flightId}`
      : sql`status = 'HELD' AND held_until <= ${now}`;

    const res = await this.dbClient.db
      .update(flightSeats)
      .set({
        status: 'AVAILABLE',
        heldByUserId: null,
        heldUntil: null,
        version: sql`${flightSeats.version} + 1`,
        updatedAt: new Date(),
      })
      .where(condition)
      .returning();

    return res.length;
  }
}
