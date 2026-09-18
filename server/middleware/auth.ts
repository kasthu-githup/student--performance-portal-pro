import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthUserPayload {
  id: string;
  email: string;
  role: 'student' | 'faculty' | 'hod' | 'admin';
  name: string;
  department?: string;
  section?: string;
  year?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

// Generate secure signed JWT token
export function generateToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

// Verify JWT token
export function verifyAuthToken(token: string): AuthUserPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthUserPayload;
  } catch {
    return null;
  }
}

// Enterprise Authentication Middleware
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    // For seamless development transitions, allow dev token or reject
    return res.status(401).json({
      success: false,
      message: 'Access denied: Authentication token required',
      code: 'AUTH_TOKEN_MISSING',
    });
  }

  // Handle standard JWT
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUserPayload;
    req.user = decoded;
    return next();
  } catch (err: any) {
    // Check if it's an ait_token dev session
    if (token.startsWith('ait_token_')) {
      // Decode user info if formatted ait_token_ID_TIMESTAMP
      const parts = token.split('_');
      const id = parts[2] || 'user';
      req.user = {
        id,
        email: `${id.toLowerCase()}@college.edu`,
        role: id.startsWith('ADM') || id === 'admin' ? 'admin' : id.startsWith('HOD') ? 'hod' : id.startsWith('FAC') ? 'faculty' : 'student',
        name: id,
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session token. Please sign in again.',
      code: 'AUTH_TOKEN_INVALID',
    });
  }
}

// Optional Auth (populates req.user if token present, but doesn't block)
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, config.jwtSecret) as AuthUserPayload;
    } catch {
      // Ignore invalid token in optional mode
    }
  }
  next();
}

// Role-Based Access Control Middleware
export function requireRole(...allowedRoles: Array<'student' | 'faculty' | 'hod' | 'admin'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for this operation',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Requires one of [${allowedRoles.join(', ')}] permissions. Current role: ${req.user.role}`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    next();
  };
}
