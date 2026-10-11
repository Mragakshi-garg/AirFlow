import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TokenService, createAuthApp } from '../services/auth-service/src/index';
import { createAdminApp } from '../services/admin-service/src/index';
import { UserRole } from '@airline/types';

describe('Phase 3 Auth & Admin Service - Comprehensive Pass Checks', () => {
  let authServer: http.Server;
  let authBaseUrl: string;

  let adminServer: http.Server;
  let adminBaseUrl: string;

  let tokenService: TokenService;

  before(async () => {
    tokenService = new TokenService({
      jwtSecret: 'test-secret-airline-phase3',
      expiresIn: '2h',
    });

    // Start Auth app on ephemeral port
    const authSetup = createAuthApp({ tokenService });
    await new Promise<void>((resolve) => {
      authServer = authSetup.app.listen(0, () => {
        const addr = authServer.address() as any;
        authBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Start Admin app on ephemeral port sharing tokenService
    const adminSetup = createAdminApp({ tokenService });
    await new Promise<void>((resolve) => {
      adminServer = adminSetup.app.listen(0, () => {
        const addr = adminServer.address() as any;
        adminBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (authServer) authServer.close();
    if (adminServer) adminServer.close();
    if (tokenService) await tokenService.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Token Service & Revocation List Verification
  // ---------------------------------------------------------------------------
  describe('1. Token Service & Token Revocation List', () => {
    it('should generate and verify valid JWT token', async () => {
      const payload = {
        userId: 'usr-phase3-1',
        email: 'pilot@airline.com',
        role: 'USER' as UserRole,
      };

      const token = tokenService.generateToken(payload);
      assert.ok(token);

      const verified = await tokenService.verifyToken(token);
      assert.ok(verified);
      assert.strictEqual(verified.userId, payload.userId);
      assert.strictEqual(verified.email, payload.email);
      assert.strictEqual(verified.role, payload.role);
    });

    it('should revoke token and block subsequent verification', async () => {
      const token = tokenService.generateToken({
        userId: 'usr-revoke-1',
        email: 'passenger2@example.com',
        role: 'USER',
      });

      // Before revocation
      assert.strictEqual(await tokenService.isTokenRevoked(token), false);
      const preCheck = await tokenService.verifyToken(token);
      assert.ok(preCheck);

      // Revoke token
      await tokenService.revokeToken(token);

      // After revocation
      assert.strictEqual(await tokenService.isTokenRevoked(token), true);
      const postCheck = await tokenService.verifyToken(token);
      assert.strictEqual(postCheck, null, 'Revoked token verification must return null');
    });

    it('should reject invalid or forged tokens', async () => {
      const invalidToken = 'not.a.valid.jwt.token';
      const result = await tokenService.verifyToken(invalidToken);
      assert.strictEqual(result, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Auth Service HTTP Endpoints Verification
  // ---------------------------------------------------------------------------
  describe('2. Auth Service HTTP Endpoints', () => {
    let testUserToken = '';

    it('POST /api/auth/register should create new user and return token', async () => {
      const res = await fetch(`${authBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
          role: 'USER',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json() as any;
      assert.ok(body.token);
      assert.strictEqual(body.user.email, 'newuser@example.com');
      assert.strictEqual(body.user.role, 'USER');
      testUserToken = body.token;
    });

    it('POST /api/auth/register should reject duplicate email with 409', async () => {
      const res = await fetch(`${authBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
        }),
      });

      assert.strictEqual(res.status, 409);
    });

    it('POST /api/auth/login should authenticate and return token', async () => {
      const res = await fetch(`${authBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'Password123!',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json() as any;
      assert.ok(body.token);
      assert.strictEqual(body.user.email, 'newuser@example.com');
    });

    it('POST /api/auth/login should reject bad password with 401', async () => {
      const res = await fetch(`${authBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'WrongPassword!',
        }),
      });

      assert.strictEqual(res.status, 401);
    });

    it('GET /api/auth/me should return user details with valid token', async () => {
      const res = await fetch(`${authBaseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${testUserToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json() as any;
      assert.strictEqual(body.user.email, 'newuser@example.com');
    });

    it('POST /api/auth/logout should revoke token', async () => {
      // Logout
      const logoutRes = await fetch(`${authBaseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      assert.strictEqual(logoutRes.status, 200);

      // Verify token is now blocked on protected routes
      const meRes = await fetch(`${authBaseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      assert.strictEqual(meRes.status, 401, 'Logged out token should be denied access');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Admin Service & RBAC Verification
  // ---------------------------------------------------------------------------
  describe('3. Admin Service & RBAC Protection', () => {
    let adminToken: string;
    let passengerToken: string;

    before(() => {
      adminToken = tokenService.generateToken({
        userId: 'admin-id-1',
        email: 'admin@airline.com',
        role: 'ADMIN',
      });

      passengerToken = tokenService.generateToken({
        userId: 'user-id-1',
        email: 'passenger@example.com',
        role: 'USER',
      });
    });

    it('GET /api/admin/airlines should reject unauthenticated request with 401', async () => {
      const res = await fetch(`${adminBaseUrl}/api/admin/airlines`);
      assert.strictEqual(res.status, 401);
    });

    it('GET /api/admin/airlines should reject USER role with 403 Forbidden', async () => {
      const res = await fetch(`${adminBaseUrl}/api/admin/airlines`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    it('GET /api/admin/airlines should allow ADMIN role with 200 OK', async () => {
      const res = await fetch(`${adminBaseUrl}/api/admin/airlines`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json() as any;
      assert.ok(body.count > 0);
      assert.ok(Array.isArray(body.data));
    });

    it('POST /api/admin/airlines should create new airline', async () => {
      const res = await fetch(`${adminBaseUrl}/api/admin/airlines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          code: 'SG',
          name: 'SpiceJet',
          country: 'India',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json() as any;
      assert.strictEqual(body.data.code, 'SG');
    });

    it('POST /api/admin/flights should schedule a new flight', async () => {
      const res = await fetch(`${adminBaseUrl}/api/admin/flights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airlineId: '11111111-1111-4111-a111-111111111111',
          aircraftId: 'c1111111-0000-4000-b000-000000000001',
          flightNumber: 'EK-500',
          originAirportId: 'a1111111-0000-4000-a000-000000000003',
          destinationAirportId: 'a1111111-0000-4000-a000-000000000005',
          departureTime: new Date(Date.now() + 86400000).toISOString(),
          durationMinutes: 210,
          basePrice: 32000,
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json() as any;
      assert.strictEqual(body.data.flightNumber, 'EK-500');
      assert.strictEqual(body.data.status, 'SCHEDULED');
    });

    it('PUT /api/admin/flights/:id/status should update flight status', async () => {
      // First create flight
      const createRes = await fetch(`${adminBaseUrl}/api/admin/flights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airlineId: '11111111-1111-4111-a111-111111111111',
          aircraftId: 'c1111111-0000-4000-b000-000000000001',
          flightNumber: 'EK-999',
          originAirportId: 'a1111111-0000-4000-a000-000000000003',
          destinationAirportId: 'a1111111-0000-4000-a000-000000000005',
          departureTime: new Date().toISOString(),
          durationMinutes: 180,
          basePrice: 25000,
        }),
      });
      const flight = (await createRes.json() as any).data;

      // Update status to DELAYED
      const updateRes = await fetch(`${adminBaseUrl}/api/admin/flights/${flight.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: 'DELAYED' }),
      });

      assert.strictEqual(updateRes.status, 200);
      const body = await updateRes.json() as any;
      assert.strictEqual(body.data.status, 'DELAYED');
    });

    it('POST /api/admin/flights/:id/seats/generate should generate seat matrix', async () => {
      const flightId = 'flt-inventory-test';

      const res = await fetch(`${adminBaseUrl}/api/admin/flights/${flightId}/seats/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ basePrice: 20000, rowCount: 15 }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json() as any;
      assert.ok(body.seatCount > 0);
      assert.strictEqual(body.flightId, flightId);

      // Verify GET seats
      const getRes = await fetch(`${adminBaseUrl}/api/admin/flights/${flightId}/seats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(getRes.status, 200);
      const getBody = await getRes.json() as any;
      assert.strictEqual(getBody.totalSeats, body.seatCount);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. API Gateway Configuration Verification
  // ---------------------------------------------------------------------------
  describe('4. Nginx Gateway Configuration Validation', () => {
    it('should verify nginx.conf defines routing for /api/auth/ and /api/admin/', () => {
      const nginxConfigPath = path.resolve(__dirname, '../infrastructure/nginx/nginx.conf');
      assert.ok(fs.existsSync(nginxConfigPath), 'nginx.conf must exist');

      const config = fs.readFileSync(nginxConfigPath, 'utf8');
      assert.ok(config.includes('location /api/auth/'));
      assert.ok(config.includes('location /api/admin/'));
      assert.ok(config.includes('proxy_pass http://auth_service;'));
      assert.ok(config.includes('proxy_pass http://admin_service;'));
    });
  });

});
