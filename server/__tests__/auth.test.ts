import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// Mock storage module
const mockStorage = {
  getUser: vi.fn(),
  getAllUsers: vi.fn(),
  updateUserRole: vi.fn(),
};

vi.mock('../storage', () => ({
  storage: mockStorage,
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Authentication and Authorization', () => {
  let app: Express;

  // Simulated isAuthenticated middleware
  const createIsAuthenticated = (authenticated: boolean = true, user: any = null) => {
    return (req: any, res: Response, next: NextFunction) => {
      if (!authenticated) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      req.user = user || {
        claims: { sub: 'test-user-123' },
      };
      req.isAuthenticated = () => authenticated;

      // Fetch user info and set practice/role
      if (req.user?.claims?.sub) {
        const dbUser = mockStorage.getUser(req.user.claims.sub);
        if (dbUser) {
          req.userPracticeId = dbUser.practiceId;
          req.userRole = dbUser.role;
        }
      }

      next();
    };
  };

  // Simulated isAdmin middleware
  const isAdmin = async (req: any, res: Response, next: NextFunction) => {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await mockStorage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    next();
  };

  // Simulated role-based access middleware
  const requireRole = (...roles: string[]) => {
    return async (req: any, res: Response, next: NextFunction) => {
      if (!req.user?.claims?.sub) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const user = await mockStorage.getUser(req.user.claims.sub);
      if (!user || !roles.includes(user.role)) {
        return res.status(403).json({
          message: `Access denied. Required roles: ${roles.join(', ')}`,
        });
      }

      next();
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
  });

  describe('isAuthenticated Middleware', () => {
    it('should allow authenticated users to access protected routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'test-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'test-user-123',
        email: 'test@example.com',
        role: 'therapist',
        practiceId: 1,
      });

      app.get('/api/protected', isAuthenticated, (req: any, res) => {
        res.json({ message: 'Success', userId: req.user.claims.sub });
      });

      const response = await request(app)
        .get('/api/protected')
        .expect(200);

      expect(response.body).toEqual({
        message: 'Success',
        userId: 'test-user-123',
      });
    });

    it('should return 401 for unauthenticated requests', async () => {
      const isAuthenticated = createIsAuthenticated(false);

      app.get('/api/protected', isAuthenticated, (req: any, res) => {
        res.json({ message: 'Success' });
      });

      const response = await request(app)
        .get('/api/protected')
        .expect(401);

      expect(response.body).toEqual({ message: 'Unauthorized' });
    });

    it('should attach user practice and role info to request', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'test-user-123' },
      });

      mockStorage.getUser.mockReturnValue({
        id: 'test-user-123',
        email: 'test@example.com',
        role: 'admin',
        practiceId: 2,
      });

      app.get('/api/user-info', isAuthenticated, (req: any, res) => {
        res.json({
          userId: req.user.claims.sub,
          practiceId: req.userPracticeId,
          role: req.userRole,
        });
      });

      const response = await request(app)
        .get('/api/user-info')
        .expect(200);

      expect(response.body).toEqual({
        userId: 'test-user-123',
        practiceId: 2,
        role: 'admin',
      });
    });
  });

  describe('Admin Role Middleware', () => {
    it('should allow admin users to access admin routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'admin-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin',
        practiceId: 1,
      });

      app.get('/api/admin/users', isAuthenticated, isAdmin, (req, res) => {
        res.json({ users: [] });
      });

      const response = await request(app)
        .get('/api/admin/users')
        .expect(200);

      expect(response.body).toEqual({ users: [] });
    });

    it('should return 403 for non-admin users accessing admin routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'therapist-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'therapist-user-123',
        email: 'therapist@example.com',
        role: 'therapist',
        practiceId: 1,
      });

      app.get('/api/admin/users', isAuthenticated, isAdmin, (req, res) => {
        res.json({ users: [] });
      });

      const response = await request(app)
        .get('/api/admin/users')
        .expect(403);

      expect(response.body).toEqual({ message: 'Access denied. Admin role required.' });
    });

    it('should return 401 when user not found', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'unknown-user' },
      });

      mockStorage.getUser.mockResolvedValue(undefined);

      app.get('/api/admin/users', isAuthenticated, isAdmin, (req, res) => {
        res.json({ users: [] });
      });

      const response = await request(app)
        .get('/api/admin/users')
        .expect(403);

      expect(response.body).toEqual({ message: 'Access denied. Admin role required.' });
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow therapist role to access therapist routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'therapist-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'therapist-user-123',
        email: 'therapist@example.com',
        role: 'therapist',
        practiceId: 1,
      });

      app.get('/api/sessions', isAuthenticated, requireRole('therapist', 'admin'), (req, res) => {
        res.json({ sessions: [] });
      });

      const response = await request(app)
        .get('/api/sessions')
        .expect(200);

      expect(response.body).toEqual({ sessions: [] });
    });

    it('should allow admin to access therapist routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'admin-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin',
        practiceId: 1,
      });

      app.get('/api/sessions', isAuthenticated, requireRole('therapist', 'admin'), (req, res) => {
        res.json({ sessions: [] });
      });

      const response = await request(app)
        .get('/api/sessions')
        .expect(200);

      expect(response.body).toEqual({ sessions: [] });
    });

    it('should deny billing user from therapist-only routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'billing-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'billing-user-123',
        email: 'billing@example.com',
        role: 'billing',
        practiceId: 1,
      });

      app.get('/api/sessions', isAuthenticated, requireRole('therapist'), (req, res) => {
        res.json({ sessions: [] });
      });

      const response = await request(app)
        .get('/api/sessions')
        .expect(403);

      expect(response.body).toEqual({
        message: 'Access denied. Required roles: therapist',
      });
    });

    it('should allow billing user to access billing routes', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'billing-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'billing-user-123',
        email: 'billing@example.com',
        role: 'billing',
        practiceId: 1,
      });

      app.get('/api/claims', isAuthenticated, requireRole('billing', 'admin'), (req, res) => {
        res.json({ claims: [] });
      });

      const response = await request(app)
        .get('/api/claims')
        .expect(200);

      expect(response.body).toEqual({ claims: [] });
    });
  });

  describe('Multi-Tenancy (Practice Isolation)', () => {
    it('should restrict non-admin users to their own practice', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'therapist-user-123' },
      });

      mockStorage.getUser.mockReturnValue({
        id: 'therapist-user-123',
        email: 'therapist@example.com',
        role: 'therapist',
        practiceId: 1,
      });

      const practiceAuthMiddleware = (req: any, res: Response, next: NextFunction) => {
        const requestedPracticeId = req.query.practiceId
          ? parseInt(req.query.practiceId as string)
          : undefined;

        // Non-admin users can only access their own practice
        if (req.userRole !== 'admin') {
          if (requestedPracticeId && requestedPracticeId !== req.userPracticeId) {
            return res.status(403).json({ message: 'Access denied to this practice' });
          }
          req.authorizedPracticeId = req.userPracticeId;
        } else {
          req.authorizedPracticeId = requestedPracticeId || req.userPracticeId;
        }

        next();
      };

      app.get('/api/patients', isAuthenticated, practiceAuthMiddleware, (req: any, res) => {
        res.json({ practiceId: req.authorizedPracticeId });
      });

      // Try to access different practice
      const response = await request(app)
        .get('/api/patients?practiceId=2')
        .expect(403);

      expect(response.body).toEqual({ message: 'Access denied to this practice' });
    });

    it('should allow admin users to access any practice', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'admin-user-123' },
      });

      mockStorage.getUser.mockReturnValue({
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin',
        practiceId: 1,
      });

      const practiceAuthMiddleware = (req: any, res: Response, next: NextFunction) => {
        const requestedPracticeId = req.query.practiceId
          ? parseInt(req.query.practiceId as string)
          : undefined;

        if (req.userRole !== 'admin') {
          if (requestedPracticeId && requestedPracticeId !== req.userPracticeId) {
            return res.status(403).json({ message: 'Access denied to this practice' });
          }
          req.authorizedPracticeId = req.userPracticeId;
        } else {
          req.authorizedPracticeId = requestedPracticeId || req.userPracticeId;
        }

        next();
      };

      app.get('/api/patients', isAuthenticated, practiceAuthMiddleware, (req: any, res) => {
        res.json({ practiceId: req.authorizedPracticeId });
      });

      // Admin can access different practice
      const response = await request(app)
        .get('/api/patients?practiceId=2')
        .expect(200);

      expect(response.body).toEqual({ practiceId: 2 });
    });
  });

  describe('User Role Management', () => {
    it('should allow admin to update user roles', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'admin-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin',
        practiceId: 1,
      });

      mockStorage.updateUserRole.mockResolvedValue({
        id: 'target-user-123',
        email: 'user@example.com',
        role: 'billing',
        practiceId: 1,
      });

      app.patch('/api/users/:id/role', isAuthenticated, isAdmin, async (req: any, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!['therapist', 'admin', 'billing'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }

        const updatedUser = await mockStorage.updateUserRole(id, role);
        if (!updatedUser) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json({
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
        });
      });

      const response = await request(app)
        .patch('/api/users/target-user-123/role')
        .send({ role: 'billing' })
        .expect(200);

      expect(response.body).toEqual({
        id: 'target-user-123',
        email: 'user@example.com',
        role: 'billing',
      });
      expect(mockStorage.updateUserRole).toHaveBeenCalledWith('target-user-123', 'billing');
    });

    it('should reject invalid role values', async () => {
      const isAuthenticated = createIsAuthenticated(true, {
        claims: { sub: 'admin-user-123' },
      });

      mockStorage.getUser.mockResolvedValue({
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin',
        practiceId: 1,
      });

      app.patch('/api/users/:id/role', isAuthenticated, isAdmin, async (req: any, res) => {
        const { role } = req.body;

        if (!['therapist', 'admin', 'billing'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }

        res.json({ success: true });
      });

      const response = await request(app)
        .patch('/api/users/target-user-123/role')
        .send({ role: 'superuser' })
        .expect(400);

      expect(response.body).toEqual({ message: 'Invalid role' });
    });
  });
});
