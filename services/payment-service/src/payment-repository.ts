import { Payment, PaymentStatus, IdempotencyRecord } from '@airline/types';

export interface PaymentRepository {
  createPayment(payment: Payment): Promise<Payment>;
  getPaymentById(id: string): Promise<Payment | null>;
  getPaymentsByBookingId(bookingId: string): Promise<Payment[]>;
  updatePaymentStatus(
    id: string,
    status: PaymentStatus,
    transactionId?: string,
    errorMessage?: string
  ): Promise<Payment | null>;
  getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null>;
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private payments: Map<string, Payment> = new Map();
  private idempotencyStore: Map<string, IdempotencyRecord> = new Map();

  async createPayment(payment: Payment): Promise<Payment> {
    const copy: Payment = {
      ...payment,
      createdAt: new Date(payment.createdAt || Date.now()),
      updatedAt: new Date(payment.updatedAt || Date.now()),
    };
    this.payments.set(copy.id, copy);
    return { ...copy };
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const payment = this.payments.get(id);
    return payment ? { ...payment } : null;
  }

  async getPaymentsByBookingId(bookingId: string): Promise<Payment[]> {
    return Array.from(this.payments.values())
      .filter((p) => p.bookingId === bookingId)
      .map((p) => ({ ...p }));
  }

  async updatePaymentStatus(
    id: string,
    status: PaymentStatus,
    transactionId?: string,
    errorMessage?: string
  ): Promise<Payment | null> {
    const payment = this.payments.get(id);
    if (!payment) return null;

    payment.status = status;
    if (transactionId) payment.transactionId = transactionId;
    if (errorMessage !== undefined) payment.errorMessage = errorMessage;
    payment.updatedAt = new Date();

    this.payments.set(id, payment);
    return { ...payment };
  }

  async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const record = this.idempotencyStore.get(key);
    return record ? { ...record } : null;
  }

  async saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotencyStore.set(record.idempotencyKey, { ...record });
  }

  async clear(): Promise<void> {
    this.payments.clear();
    this.idempotencyStore.clear();
  }
}
