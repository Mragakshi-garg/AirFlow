import { generateFullDataset } from './seed-generator';
import { getDatabaseClient } from './client';
import { airlines, airports, aircrafts, users, flights, flightSeats } from './schema';

export async function runSeeder(options: { targetFlights?: number; dryRun?: boolean } = {}) {
  const targetFlights = options.targetFlights || 1000;
  console.log(`[SEEDER] Generating synthetic dataset (${targetFlights} flights target)...`);

  const dataset = generateFullDataset(targetFlights);

  console.log(`[SEEDER] Generated:`);
  console.log(`  - Airlines:   ${dataset.airlines.length}`);
  console.log(`  - Airports:   ${dataset.airports.length}`);
  console.log(`  - Aircrafts:  ${dataset.aircrafts.length}`);
  console.log(`  - Users:      ${dataset.users.length}`);
  console.log(`  - Flights:    ${dataset.flights.length}`);
  console.log(`  - Seats:      ${dataset.flightSeats.length}`);

  if (options.dryRun) {
    console.log(`[SEEDER] Dry-run enabled. Skipping database insertion.`);
    return dataset;
  }

  const client = getDatabaseClient();
  const dbConnected = await client.testConnection();

  if (!dbConnected) {
    console.warn(`[SEEDER] PostgreSQL database is not reachable at ${process.env.DATABASE_URL || 'default localhost:5432'}. Generated dataset validated in-memory.`);
    return dataset;
  }

  console.log(`[SEEDER] Connected to PostgreSQL. Inserting records in batches...`);
  const db = client.db;

  try {
    // 1. Insert Airlines
    await db.insert(airlines).values(dataset.airlines as any).onConflictDoNothing();
    // 2. Insert Airports
    await db.insert(airports).values(dataset.airports as any).onConflictDoNothing();
    // 3. Insert Aircrafts
    await db.insert(aircrafts).values(dataset.aircrafts as any).onConflictDoNothing();
    // 4. Insert Users
    await db.insert(users).values(dataset.users as any).onConflictDoNothing();

    // 5. Insert Flights in batches of 200
    const batchSize = 200;
    for (let i = 0; i < dataset.flights.length; i += batchSize) {
      const batch = dataset.flights.slice(i, i + batchSize);
      await db.insert(flights).values(batch as any).onConflictDoNothing();
    }

    // 6. Insert Flight Seats in batches of 500
    for (let i = 0; i < dataset.flightSeats.length; i += 500) {
      const batch = dataset.flightSeats.slice(i, i + 500);
      await db.insert(flightSeats).values(batch as any).onConflictDoNothing();
    }

    console.log(`[SEEDER] Successfully seeded database!`);
  } catch (err) {
    console.error(`[SEEDER] Error during database insertion:`, err);
    throw err;
  } finally {
    await client.close();
  }

  return dataset;
}

// Allow direct execution: node dist/seed.js or tsx src/seed.ts
if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
  runSeeder()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
