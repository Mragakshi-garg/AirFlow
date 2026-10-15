import { FlightSeat } from '@airline/types';
import { createLogger } from '@airline/logger';
import { RedlockManager, LockHandle } from './redlock';
import { InventoryRepository, SeatUpdateResult } from './inventory-repository';

const logger = createLogger('inventory-service');

export class ConcurrencyError extends Error {
  constructor(message: string, public code: 'LOCKED' | 'OCC_CONFLICT' | 'SEAT_NOT_AVAILABLE' | 'NOT_FOUND' | 'UNAUTHORIZED') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface HoldSeatResult {
  success: boolean;
  seat: FlightSeat;
  heldUntil: Date;
  lockType: '3-TIERED (REDLOCK + OCC + ROW_LOCK)';
}

export interface InventoryServiceConfig {
  defaultHoldDurationSeconds?: number;
  lockTtlMs?: number;
}

export class InventoryService {
  private defaultHoldDurationSeconds: number;
  private lockTtlMs: number;

  constructor(
    private repo: InventoryRepository,
    private redlock: RedlockManager,
    config?: InventoryServiceConfig
  ) {
    this.defaultHoldDurationSeconds = config?.defaultHoldDurationSeconds || 600; // 10 minutes
    this.lockTtlMs = config?.lockTtlMs || 5000; // 5 seconds
  }

  /**
   * 3-Tiered Concurrency Core: Hold a seat
   * Tier 1: Redlock distributed lock
   * Tier 2: Optimistic Concurrency Control (OCC)
   * Tier 3: Pessimistic Row-Level Lock (`SELECT ... FOR UPDATE`)
   */
  async holdSeat(
    seatId: string,
    userId: string,
    holdDurationSeconds?: number
  ): Promise<HoldSeatResult> {
    const duration = holdDurationSeconds || this.defaultHoldDurationSeconds;
    const lockResource = `seat:${seatId}`;

    // ─────────────────────────────────────────────────────────────
    // Tier 1: Distributed Lock (Redlock)
    // ─────────────────────────────────────────────────────────────
    const lockHandle: LockHandle | null = await this.redlock.acquire(lockResource, this.lockTtlMs);

    if (!lockHandle) {
      logger.warn('Tier 1: Redlock acquisition failed — seat currently locked by another request', {
        seatId,
        userId,
      });
      throw new ConcurrencyError(
        'Seat is currently locked by a concurrent transaction. Please retry.',
        'LOCKED'
      );
    }

    try {
      // ─────────────────────────────────────────────────────────────
      // Tier 3: Pessimistic Row Lock (`SELECT ... FOR UPDATE`)
      // ─────────────────────────────────────────────────────────────
      const updateResult: SeatUpdateResult = await this.repo.withRowLock(
        seatId,
        async (currentSeat: FlightSeat) => {
          // Check seat availability
          const now = Date.now();
          const isHeld = currentSeat.status === 'HELD';
          const isHeldExpired = isHeld && currentSeat.heldUntil && new Date(currentSeat.heldUntil).getTime() <= now;

          if (currentSeat.status === 'BOOKED' || currentSeat.status === 'BLOCKED') {
            throw new ConcurrencyError(
              `Seat ${currentSeat.seatNumber} is ${currentSeat.status.toLowerCase()} and cannot be held`,
              'SEAT_NOT_AVAILABLE'
            );
          }

          if (isHeld && !isHeldExpired && currentSeat.heldByUserId !== userId) {
            throw new ConcurrencyError(
              `Seat ${currentSeat.seatNumber} is already held by another user`,
              'SEAT_NOT_AVAILABLE'
            );
          }

          const heldUntil = new Date(now + duration * 1000);

          // ─────────────────────────────────────────────────────────
          // Tier 2: Optimistic Concurrency Control (OCC)
          // ─────────────────────────────────────────────────────────
          const occResult = await this.repo.updateSeatWithOCC(seatId, currentSeat.version, {
            status: 'HELD',
            heldByUserId: userId,
            heldUntil,
          });

          if (!occResult.success || occResult.conflict) {
            throw new ConcurrencyError(
              occResult.errorMessage || 'OCC version conflict detected during seat hold',
              'OCC_CONFLICT'
            );
          }

          return occResult;
        }
      );

      logger.info('Seat successfully held with 3-tiered concurrency protection', {
        seatId,
        userId,
        newVersion: updateResult.seat?.version,
      });

      return {
        success: true,
        seat: updateResult.seat!,
        heldUntil: updateResult.seat!.heldUntil!,
        lockType: '3-TIERED (REDLOCK + OCC + ROW_LOCK)',
      };
    } finally {
      // Safely release Tier 1 Redlock
      await lockHandle.release().catch((err) => {
        logger.error('Failed to release Redlock', err, { seatId });
      });
    }
  }

  /**
   * Release a previously held seat
   */
  async releaseSeat(
    seatId: string,
    userId: string,
    reason: string = 'USER_RELEASED'
  ): Promise<{ success: boolean; seat: FlightSeat }> {
    const lockResource = `seat:${seatId}`;
    const lockHandle = await this.redlock.acquire(lockResource, this.lockTtlMs);

    if (!lockHandle) {
      throw new ConcurrencyError('Seat is currently undergoing modification', 'LOCKED');
    }

    try {
      return await this.repo.withRowLock(seatId, async (currentSeat: FlightSeat) => {
        if (currentSeat.status === 'AVAILABLE') {
          return { success: true, seat: currentSeat };
        }

        if (currentSeat.status === 'BOOKED') {
          throw new ConcurrencyError('Cannot release a booked seat', 'SEAT_NOT_AVAILABLE');
        }

        // Allow release if held by this user or if hold expired
        if (currentSeat.heldByUserId && currentSeat.heldByUserId !== userId) {
          throw new ConcurrencyError('You are not authorized to release this seat hold', 'UNAUTHORIZED');
        }

        const updateResult = await this.repo.updateSeatWithOCC(seatId, currentSeat.version, {
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
        });

        if (!updateResult.success) {
          throw new ConcurrencyError(
            updateResult.errorMessage || 'Failed to update seat status',
            'OCC_CONFLICT'
          );
        }

        logger.info('Seat released', { seatId, userId, reason });
        return { success: true, seat: updateResult.seat! };
      });
    } finally {
      await lockHandle.release().catch(() => {});
    }
  }

  /**
   * Confirm seat from HELD to BOOKED
   */
  async confirmSeat(
    seatId: string,
    userId: string,
    bookingId: string
  ): Promise<{ success: boolean; seat: FlightSeat }> {
    const lockResource = `seat:${seatId}`;
    const lockHandle = await this.redlock.acquire(lockResource, this.lockTtlMs);

    if (!lockHandle) {
      throw new ConcurrencyError('Seat is currently undergoing modification', 'LOCKED');
    }

    try {
      return await this.repo.withRowLock(seatId, async (currentSeat: FlightSeat) => {
        if (currentSeat.status === 'BOOKED') {
          return { success: true, seat: currentSeat };
        }

        if (currentSeat.status !== 'HELD') {
          throw new ConcurrencyError('Seat must be held before confirmation', 'SEAT_NOT_AVAILABLE');
        }

        if (currentSeat.heldByUserId !== userId) {
          throw new ConcurrencyError('Seat is not held by the requesting user', 'UNAUTHORIZED');
        }

        // Verify hold has not expired
        if (currentSeat.heldUntil && new Date(currentSeat.heldUntil).getTime() <= Date.now()) {
          throw new ConcurrencyError('Seat hold has expired', 'SEAT_NOT_AVAILABLE');
        }

        const updateResult = await this.repo.updateSeatWithOCC(seatId, currentSeat.version, {
          status: 'BOOKED',
          heldByUserId: userId,
          heldUntil: null,
        });

        if (!updateResult.success) {
          throw new ConcurrencyError(
            updateResult.errorMessage || 'Failed to confirm seat booking',
            'OCC_CONFLICT'
          );
        }

        logger.info('Seat booking confirmed', { seatId, userId, bookingId });
        return { success: true, seat: updateResult.seat! };
      });
    } finally {
      await lockHandle.release().catch(() => {});
    }
  }

  /**
   * Cancel a confirmed seat booking (returns seat to AVAILABLE status)
   */
  async cancelSeatBooking(
    seatId: string,
    userId: string,
    reason: string = 'BOOKING_CANCELLED'
  ): Promise<{ success: boolean; seat: FlightSeat }> {
    const lockResource = `seat:${seatId}`;
    const lockHandle = await this.redlock.acquire(lockResource, this.lockTtlMs);

    if (!lockHandle) {
      throw new ConcurrencyError('Seat is currently undergoing modification', 'LOCKED');
    }

    try {
      return await this.repo.withRowLock(seatId, async (currentSeat: FlightSeat) => {
        if (currentSeat.status === 'AVAILABLE') {
          return { success: true, seat: currentSeat };
        }

        if (currentSeat.heldByUserId && currentSeat.heldByUserId !== userId) {
          throw new ConcurrencyError('Unauthorized to cancel this seat booking', 'UNAUTHORIZED');
        }

        const updateResult = await this.repo.updateSeatWithOCC(seatId, currentSeat.version, {
          status: 'AVAILABLE',
          heldByUserId: null,
          heldUntil: null,
        });

        if (!updateResult.success) {
          throw new ConcurrencyError(
            updateResult.errorMessage || 'Failed to cancel seat booking',
            'OCC_CONFLICT'
          );
        }

        logger.info('Seat booking cancelled, returned to AVAILABLE', { seatId, userId, reason });
        return { success: true, seat: updateResult.seat! };
      });
    } finally {
      await lockHandle.release().catch(() => {});
    }
  }

  /**
   * Get flight seat inventory with real-time hold statuses
   */
  async getSeatsByFlight(flightId: string): Promise<FlightSeat[]> {
    return this.repo.getSeatsByFlightId(flightId);
  }

  /**
   * Get a single seat by ID
   */
  async getSeatById(seatId: string): Promise<FlightSeat | null> {
    return this.repo.getSeatById(seatId);
  }

  /**
   * Helper to seed/save seats for a flight
   */
  async saveSeats(seats: FlightSeat[]): Promise<FlightSeat[]> {
    return this.repo.saveSeats(seats);
  }
}
