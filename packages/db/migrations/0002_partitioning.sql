-- ========================================================
-- 0002_partitioning.sql
-- Declarative Range Partitioning for High-Volume Tables
-- (flights partitioned by departure_time, bookings partitioned by created_at)
-- ========================================================

-- 1. Partitioned Flights Table Definition
CREATE TABLE IF NOT EXISTS flights_partitioned (
    id UUID DEFAULT uuid_generate_v4(),
    airline_id UUID NOT NULL,
    aircraft_id UUID NOT NULL,
    flight_number VARCHAR(50) NOT NULL,
    origin_airport_id UUID NOT NULL,
    destination_airport_id UUID NOT NULL,
    departure_time TIMESTAMPTZ NOT NULL,
    arrival_time TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    base_price INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, departure_time)
) PARTITION BY RANGE (departure_time);

-- Monthly partitions for Flights (Q4 2026 through Q1 2027)
CREATE TABLE IF NOT EXISTS flights_2026_10 PARTITION OF flights_partitioned
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS flights_2026_11 PARTITION OF flights_partitioned
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS flights_2026_12 PARTITION OF flights_partitioned
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS flights_2027_01 PARTITION OF flights_partitioned
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS flights_default PARTITION OF flights_partitioned
    DEFAULT;

-- Indices on partitioned table
CREATE INDEX IF NOT EXISTS idx_flights_part_route ON flights_partitioned (origin_airport_id, destination_airport_id, departure_time);
CREATE INDEX IF NOT EXISTS idx_flights_part_number ON flights_partitioned (flight_number);
CREATE INDEX IF NOT EXISTS idx_flights_part_status ON flights_partitioned (status);


-- 2. Partitioned Bookings Table Definition
CREATE TABLE IF NOT EXISTS bookings_partitioned (
    id UUID DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    flight_id UUID NOT NULL,
    seat_id UUID NOT NULL,
    total_amount INTEGER NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    booking_reference VARCHAR(20) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions for Bookings
CREATE TABLE IF NOT EXISTS bookings_2026_10 PARTITION OF bookings_partitioned
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS bookings_2026_11 PARTITION OF bookings_partitioned
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS bookings_2026_12 PARTITION OF bookings_partitioned
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS bookings_2027_01 PARTITION OF bookings_partitioned
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS bookings_default PARTITION OF bookings_partitioned
    DEFAULT;

-- Indices on partitioned table
CREATE INDEX IF NOT EXISTS idx_bookings_part_user ON bookings_partitioned (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_part_pnr ON bookings_partitioned (booking_reference);
CREATE INDEX IF NOT EXISTS idx_bookings_part_status ON bookings_partitioned (status);
