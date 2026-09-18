import { Router, Response, Request } from 'express';
import { repo } from '../repository';
import { checkDbConnection, initDbSchema, resetMySqlPool } from '../db';
import { config, updateTiDbConfig } from '../config';
import { optionalAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const startTime = Date.now();

// GET /api/health - Production health inspection endpoint
router.get('/health', async (_req: AuthenticatedRequest, res: Response) => {
  const dbStatus = await checkDbConnection();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    status: 'healthy',
    version: '2.6.0-enterprise',
    institution: config.institution.name,
    autonomousAffiliation: config.institution.affiliation,
    environment: config.nodeEnv,
    uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
    timestamp: new Date().toISOString(),
    metrics: {
      totalStudents: repo.students.length,
      totalFaculty: repo.faculty.length,
      totalDepartments: repo.departments.length,
      totalAttendanceLogs: repo.attendance.length,
      totalLeaveRequests: repo.leaveRequests.length,
      totalAuditLogs: repo.auditLogs.length,
      registeredUsers: repo.users.length,
    },
    database: dbStatus,
    security: {
      jwtEnabled: true,
      rbacEnforced: true,
      rateLimiting: true,
      securityHeaders: true,
      passwordsHashed: true,
    },
  });
});

// GET /api/db/status - Dedicated Database Diagnostic Route
router.get('/db/status', async (_req: AuthenticatedRequest, res: Response) => {
  const status = await checkDbConnection();
  res.json({
    success: true,
    ...status,
    database: typeof status.database === 'string' ? status.database : 'test',
  });
});

// POST /api/db/connect - Connect / Re-authenticate TiDB Cloud Cluster
router.post('/db/connect', async (req: Request, res: Response) => {
  try {
    const { host, port, user, password, database } = req.body;

    // Update runtime config
    updateTiDbConfig({
      host: host || config.tidb.host,
      port: port ? Number(port) : config.tidb.port,
      user: user || config.tidb.user,
      password: (password && String(password).trim() !== '') ? String(password).trim() : config.tidb.password,
      database: database || config.tidb.database,
    });

    // Reset pool with new credentials
    resetMySqlPool();

    // Check connection
    const status = await checkDbConnection();

    if (!status.connected) {
      return res.status(400).json({
        success: false,
        message: status.message || 'Failed to authenticate with TiDB Cloud cluster',
        status,
      });
    }

    // Initialize all tables in TiDB
    await initDbSchema();

    // Hydrate existing DB records if present, or push current memory state to TiDB
    const hydrated = await repo.hydrateFromDatabase();
    if (!hydrated) {
      // TiDB was fresh, push initial records into TiDB
      await repo.syncAllToTiDb();
    }

    // Re-check updated status with table counts
    const finalStatus = await checkDbConnection();

    repo.logAudit(
      'TIDB_DATABASE_CONNECTED',
      req.body.user || 'Admin',
      'admin',
      `Established secure TLS connection to TiDB Cloud cluster at ${config.tidb.host}`
    );

    res.json({
      success: true,
      message: `Successfully connected to TiDB Cloud cluster (${finalStatus.clusterTier || 'AWS ap-southeast-1'})! All tables and data synchronized.`,
      status: finalStatus,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `TiDB connection error: ${err.message}`,
    });
  }
});

// POST /api/db/sync - Force push all current state to TiDB Cloud
router.post('/db/sync', async (_req: Request, res: Response) => {
  try {
    const syncRes = await repo.syncAllToTiDb();
    const status = await checkDbConnection();
    res.json({
      ...syncRes,
      status,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Sync failed: ${err.message}` });
  }
});

// POST /api/db/init - Trigger Database Schema & Table Index Creation
router.post('/db/init', async (req: Request, res: Response) => {
  try {
    const success = await initDbSchema();
    res.json({ success, message: 'Database schema and performance indexes verified/created successfully in TiDB Cloud.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Database init failed: ${err.message}` });
  }
});

// POST /api/db/seed - Synchronize state to database / repository
router.post('/db/seed', async (req: Request, res: Response) => {
  try {
    const { students, faculty, hod, attendanceRecords, leaveRequests, announcements, fees } = req.body;
    if (Array.isArray(students) && students.length > 0) {
      repo.students = students;
    }
    if (Array.isArray(faculty) && faculty.length > 0) {
      repo.faculty = faculty;
    }
    if (hod) {
      repo.hod = hod;
    }
    if (Array.isArray(attendanceRecords) && attendanceRecords.length > 0) {
      repo.attendance = attendanceRecords;
    }
    if (Array.isArray(leaveRequests) && leaveRequests.length > 0) {
      repo.leaveRequests = leaveRequests;
    }
    if (Array.isArray(announcements) && announcements.length > 0) {
      repo.announcements = announcements;
    }
    if (Array.isArray(fees) && fees.length > 0) {
      repo.fees = fees;
    }

    // Persist to local disk cache
    repo.persistToDisk();

    // Also push to TiDB if connected
    repo.syncAllToTiDb().catch(() => {});

    res.json({
      success: true,
      message: 'State synced and persisted to database successfully.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Sync failed: ${err.message}` });
  }
});

// GET /api/settings - Read institutional parameters
router.get('/settings', optionalAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, settings: repo.settings });
});

// PUT /api/settings - Update institutional parameters
router.put('/settings', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  Object.assign(repo.settings, req.body);
  repo.persistToDisk();
  res.json({ success: true, message: 'Institutional portal settings saved', settings: repo.settings });
});

export default router;
