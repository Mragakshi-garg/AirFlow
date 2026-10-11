import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User, UserRole } from '@airline/types';
import { TokenService } from './token-service';

export interface AuthRepository {
  findByEmail(email: string): Promise<User | null>;
  create(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User>;
}

// In-memory repository fallback for standalone testing or development
export class InMemoryUserRepository implements AuthRepository {
  private users: Map<string, User> = new Map();

  constructor(initialUsers: User[] = []) {
    for (const u of initialUsers) {
      this.users.set(u.email.toLowerCase(), u);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.get(email.toLowerCase()) || null;
  }

  async create(userData: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const now = new Date();
    const user: User = {
      ...userData,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.email.toLowerCase(), user);
    return user;
  }
}

export class AuthController {
  constructor(
    private tokenService: TokenService,
    private userRepo: AuthRepository
  ) {}

  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, firstName, lastName, role } = req.body;

      if (!email || !password || !firstName || !lastName) {
        res.status(400).json({ error: 'Bad Request', message: 'All fields (email, password, firstName, lastName) are required' });
        return;
      }

      const existingUser = await this.userRepo.findByEmail(email);
      if (existingUser) {
        res.status(409).json({ error: 'Conflict', message: 'User with this email already exists' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userRole: UserRole = (role as UserRole) || 'USER';

      const newUser = await this.userRepo.create({
        id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        role: userRole,
        isActive: true,
      });

      const token = this.tokenService.generateToken({
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role,
      });

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Bad Request', message: 'Email and password are required' });
        return;
      }

      const user = await this.userRepo.findByEmail(email);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const token = this.tokenService.generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.status(200).json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.token) {
        await this.tokenService.revokeToken(req.token);
      }
      res.status(200).json({ message: 'Logged out successfully, token revoked' });
    } catch (err) {
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getMe = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const user = await this.userRepo.findByEmail(req.user.email);
    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'User profile not found' });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  };
}
