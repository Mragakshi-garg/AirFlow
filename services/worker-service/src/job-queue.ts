import { Queue, Worker, Job as BullJob, ConnectionOptions } from 'bullmq';
import { createLogger } from '@airline/logger';

const logger = createLogger('job-queue');

export interface JobOptions {
  delay?: number; // milliseconds
  jobId?: string;
  attempts?: number;
  removeOnComplete?: boolean;
}

export interface GenericJob<T> {
  id: string;
  name: string;
  data: T;
  delay?: number;
  attempts: number;
  status: 'delayed' | 'waiting' | 'active' | 'completed' | 'failed';
}

export type JobHandler<T> = (job: GenericJob<T>) => Promise<void>;

export interface IJobQueue<T> {
  add(name: string, data: T, opts?: JobOptions): Promise<GenericJob<T>>;
  getJob(jobId: string): Promise<GenericJob<T> | null>;
  removeJob(jobId: string): Promise<boolean>;
  process(handler: JobHandler<T>): void;
  getCounts(): Promise<{ delayed: number; active: number; completed: number; failed: number }>;
  close(): Promise<void>;
}

/**
 * In-Memory High-Precision Job Queue (For unit tests, standalone mode, and local development)
 */
export class InMemoryJobQueue<T> implements IJobQueue<T> {
  private jobs: Map<string, GenericJob<T>> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private handler: JobHandler<T> | null = null;
  private counts = {
    delayed: 0,
    active: 0,
    completed: 0,
    failed: 0,
  };

  constructor(public readonly queueName: string) {}

  async add(name: string, data: T, opts?: JobOptions): Promise<GenericJob<T>> {
    const id = opts?.jobId || `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const delay = opts?.delay || 0;

    // Remove existing if duplicate jobId
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id)!);
      this.timers.delete(id);
      if (this.counts.delayed > 0) this.counts.delayed--;
    }

    const job: GenericJob<T> = {
      id,
      name,
      data,
      delay,
      attempts: 0,
      status: delay > 0 ? 'delayed' : 'waiting',
    };

    this.jobs.set(id, job);

    if (delay > 0) {
      this.counts.delayed++;
      const timer = setTimeout(async () => {
        this.timers.delete(id);
        if (this.counts.delayed > 0) this.counts.delayed--;
        await this.executeJob(job);
      }, delay);
      this.timers.set(id, timer);
    } else {
      setImmediate(() => this.executeJob(job));
    }

    return { ...job };
  }

  async getJob(jobId: string): Promise<GenericJob<T> | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async removeJob(jobId: string): Promise<boolean> {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
      if (this.counts.delayed > 0) this.counts.delayed--;
    }

    const deleted = this.jobs.delete(jobId);
    if (deleted) {
      logger.debug('Job removed/cancelled from queue', { queue: this.queueName, jobId });
    }
    return deleted;
  }

  process(handler: JobHandler<T>): void {
    this.handler = handler;
  }

  private async executeJob(job: GenericJob<T>): Promise<void> {
    if (!this.handler) {
      return;
    }

    job.status = 'active';
    job.attempts++;
    this.counts.active++;

    try {
      await this.handler(job);
      job.status = 'completed';
      this.counts.completed++;
    } catch (err) {
      job.status = 'failed';
      this.counts.failed++;
      logger.error('Error executing job in InMemoryJobQueue', err, {
        queue: this.queueName,
        jobId: job.id,
      });
    } finally {
      if (this.counts.active > 0) this.counts.active--;
      this.jobs.set(job.id, job);
    }
  }

  async getCounts(): Promise<{ delayed: number; active: number; completed: number; failed: number }> {
    return { ...this.counts };
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.jobs.clear();
  }
}

/**
 * Production BullMQ Adapter using Redis
 */
export class BullMQAdapter<T = any> implements IJobQueue<T> {
  private queue: Queue<any, any, string>;
  private worker: Worker<any, any, string> | null = null;

  constructor(
    public readonly queueName: string,
    private connection: ConnectionOptions
  ) {
    this.queue = new Queue<any, any, string>(queueName, { connection });
  }

  async add(name: string, data: T, opts?: JobOptions): Promise<GenericJob<T>> {
    const bullJob = await this.queue.add(name, data, {
      delay: opts?.delay,
      jobId: opts?.jobId,
      attempts: opts?.attempts || 3,
      removeOnComplete: opts?.removeOnComplete ?? true,
    });

    return {
      id: String(bullJob.id),
      name: bullJob.name,
      data: bullJob.data as T,
      delay: opts?.delay,
      attempts: bullJob.attemptsMade,
      status: (opts?.delay && opts.delay > 0) ? 'delayed' : 'waiting',
    };
  }

  async getJob(jobId: string): Promise<GenericJob<T> | null> {
    const bullJob = await this.queue.getJob(jobId);
    if (!bullJob) return null;

    const state = await bullJob.getState();
    return {
      id: String(bullJob.id),
      name: bullJob.name,
      data: bullJob.data as T,
      attempts: bullJob.attemptsMade,
      status: state as any,
    };
  }

  async removeJob(jobId: string): Promise<boolean> {
    const bullJob = await this.queue.getJob(jobId);
    if (bullJob) {
      await bullJob.remove();
      return true;
    }
    return false;
  }

  process(handler: JobHandler<T>): void {
    if (this.worker) return;

    this.worker = new Worker<any, any, string>(
      this.queueName,
      async (bullJob: BullJob<any, any, string>) => {
        const genericJob: GenericJob<T> = {
          id: String(bullJob.id),
          name: bullJob.name,
          data: bullJob.data as T,
          attempts: bullJob.attemptsMade,
          status: 'active',
        };
        await handler(genericJob);
      },
      { connection: this.connection }
    );
  }

  async getCounts(): Promise<{ delayed: number; active: number; completed: number; failed: number }> {
    const counts = await this.queue.getJobCounts('delayed', 'active', 'completed', 'failed');
    return {
      delayed: counts.delayed || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
    };
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}
