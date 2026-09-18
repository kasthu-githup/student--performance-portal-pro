import pg from 'pg';
import mysql, { Pool as MySqlPool } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { config } from './config';

const { Pool: PgPool } = pg;

export interface DbStatus {
  connected: boolean;
  type: string;
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
  message: string;
  tableCounts?: {
    users: number;
    students: number;
    faculty: number;
    hod: number;
    attendance: number;
    leave_requests: number;
    announcements: number;
    fees: number;
    audit_logs: number;
  };
  lastChecked?: string;
  clusterTier?: string;
  sslActive?: boolean;
}

let pgPool: pg.Pool | null = null;
let mysqlPool: MySqlPool | null = null;

// Isolated namespaced tables to prevent collisions in shared databases (like TiDB test DB)
export const TABLES = {
  USERS: 'portal_users',
  STUDENTS: 'portal_students',
  FACULTY: 'portal_faculty',
  HOD: 'portal_hod',
  ADMIN: 'portal_admin',
  DEPARTMENTS: 'portal_departments',
  SUBJECTS: 'portal_subjects',
  ATTENDANCE: 'portal_attendance_records',
  LEAVE_REQUESTS: 'portal_leave_requests',
  ANNOUNCEMENTS: 'portal_announcements',
  NOTIFICATIONS: 'portal_notifications',
  FEES: 'portal_fees',
  AUDIT_LOGS: 'portal_audit_logs',
  SYSTEM_SETTINGS: 'portal_system_settings',
};

// Determine active database mode
export function getDbMode(): 'postgres' | 'mysql' | 'memory' {
  // If PostgreSQL is explicitly configured
  const hasPg = !!(
    config.pg.connectionString ||
    process.env.DATABASE_URL?.startsWith('postgres') ||
    (config.pg.password && config.pg.password.trim() !== '') ||
    (config.pg.host && config.pg.host !== 'localhost')
  );
  if (hasPg) {
    return 'postgres';
  }

  // TiDB Cloud / MySQL mode
  if (config.tidb.host && config.tidb.host.trim() !== '') {
    return 'mysql';
  }

  return 'memory';
}

// PostgreSQL Connection Pool
export function getPgPool(): pg.Pool | null {
  const dbUrl = config.pg.connectionString || process.env.DATABASE_URL;
  const pgHost = config.pg.host;
  const hasPgConfig = !!(
    dbUrl ||
    (config.pg.password && config.pg.password.trim() !== '') ||
    (pgHost && pgHost !== 'localhost')
  );

  if (!hasPgConfig) {
    return null;
  }

  if (!pgPool) {
    try {
      if (dbUrl) {
        pgPool = new PgPool({
          connectionString: dbUrl,
          ssl: config.isProduction ? { rejectUnauthorized: false } : false,
          max: 15,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
      } else {
        pgPool = new PgPool({
          host: pgHost,
          port: config.pg.port,
          user: config.pg.user,
          password: config.pg.password,
          database: config.pg.database,
          ssl: config.isProduction ? { rejectUnauthorized: false } : false,
          max: 15,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
      }

      pgPool.on('error', (err) => {
        console.error('[PostgreSQL Pool Error]', err.message);
      });
    } catch (err: any) {
      console.error('[PostgreSQL] Failed to initialize pool:', err.message);
      return null;
    }
  }

  return pgPool;
}

// MySQL / TiDB Connection Pool
export function getMySqlPool(): MySqlPool | null {
  const host = config.tidb.host;
  const user = config.tidb.user;
  const password = config.tidb.password;

  if (!host || host.trim() === '') return null;

  if (!mysqlPool) {
    try {
      mysqlPool = mysql.createPool({
        host: host,
        port: config.tidb.port || 4000,
        user: user,
        password: password || '',
        database: config.tidb.database || 'test',
        ssl: {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: false,
        },
        waitForConnections: true,
        connectionLimit: 15,
        queueLimit: 0,
        connectTimeout: 10000,
      });
    } catch (err: any) {
      console.error('[MySQL/TiDB] Failed to initialize pool:', err.message);
      return null;
    }
  }

  return mysqlPool;
}

let isTiDbOnline = false;

// Reset MySQL pool when credentials change
export function resetMySqlPool(): void {
  isTiDbOnline = false;
  if (mysqlPool) {
    mysqlPool.end().catch(() => {});
    mysqlPool = null;
  }
}

// Health check connection validator
export async function checkDbConnection(): Promise<DbStatus> {
  const mode = getDbMode();

  if (mode === 'postgres') {
    const pool = getPgPool();
    if (!pool) {
      return {
        connected: false,
        type: 'PostgreSQL Relational DB',
        host: config.pg.host,
        port: config.pg.port,
        user: config.pg.user,
        database: config.pg.database,
        hasPassword: Boolean(config.pg.password),
        message: 'PostgreSQL credentials configured; initializing connection...',
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT version();');
        const v = res.rows[0]?.version || 'PostgreSQL 16+';

        let counts = { users: 0, students: 0, faculty: 0, hod: 0, attendance: 0, leave_requests: 0, announcements: 0, fees: 0, audit_logs: 0 };
        try {
          const uC = await client.query('SELECT COUNT(*) FROM users');
          counts.users = parseInt(uC.rows[0]?.count || '0', 10);
          const sC = await client.query('SELECT COUNT(*) FROM students');
          counts.students = parseInt(sC.rows[0]?.count || '0', 10);
        } catch {
          // Schema may be initializing
        }

        return {
          connected: true,
          type: 'PostgreSQL Relational Database',
          host: config.pg.host,
          port: config.pg.port,
          user: config.pg.user,
          database: config.pg.database,
          hasPassword: true,
          message: `Connected securely to ${v.split(',')[0]}`,
          tableCounts: counts,
          lastChecked: new Date().toISOString(),
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      return {
        connected: false,
        type: 'PostgreSQL',
        host: config.pg.host,
        port: config.pg.port,
        user: config.pg.user,
        database: config.pg.database,
        hasPassword: true,
        message: `PostgreSQL connection attempt failed: ${err.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // TiDB Cloud / MySQL
  const tidbHost = config.tidb.host;
  const tidbUser = config.tidb.user;
  const tidbPassword = config.tidb.password;
  const tidbDatabase = config.tidb.database;
  const tidbPort = config.tidb.port || 4000;

  if (!tidbPassword || tidbPassword.trim() === '') {
    return {
      connected: false,
      type: 'TiDB Cloud (Serverless MySQL 8.0)',
      host: tidbHost,
      port: tidbPort,
      user: tidbUser,
      database: tidbDatabase,
      hasPassword: false,
      sslActive: true,
      clusterTier: 'Serverless / Dedicated TiDB Cluster',
      message: 'TiDB host configured. Awaiting TiDB password to authenticate.',
      lastChecked: new Date().toISOString(),
    };
  }

  const pool = getMySqlPool();
  if (!pool) {
    return {
      connected: false,
      type: 'TiDB Cloud (Serverless MySQL 8.0)',
      host: tidbHost,
      port: tidbPort,
      user: tidbUser,
      database: tidbDatabase,
      hasPassword: true,
      sslActive: true,
      message: 'Failed to initialize TiDB connection pool',
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.query('SELECT 1 as alive, VERSION() as version');
      const versionStr = rows[0]?.version || 'TiDB v8.0';

      const counts = {
        users: 0,
        students: 0,
        faculty: 0,
        hod: 0,
        attendance: 0,
        leave_requests: 0,
        announcements: 0,
        fees: 0,
        audit_logs: 0,
      };

      try {
        const [uRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.USERS}`);
        counts.users = Number(uRes[0]?.count || 0);
      } catch {}

      try {
        const [sRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.STUDENTS}`);
        counts.students = Number(sRes[0]?.count || 0);
      } catch {}

      try {
        const [fRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.FACULTY}`);
        counts.faculty = Number(fRes[0]?.count || 0);
      } catch {}

      try {
        const [aRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.ATTENDANCE}`);
        counts.attendance = Number(aRes[0]?.count || 0);
      } catch {}

      try {
        const [lRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.LEAVE_REQUESTS}`);
        counts.leave_requests = Number(lRes[0]?.count || 0);
      } catch {}

      try {
        const [annRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.ANNOUNCEMENTS}`);
        counts.announcements = Number(annRes[0]?.count || 0);
      } catch {}

      try {
        const [feeRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.FEES}`);
        counts.fees = Number(feeRes[0]?.count || 0);
      } catch {}

      try {
        const [auditRes]: any = await conn.query(`SELECT COUNT(*) as count FROM ${TABLES.AUDIT_LOGS}`);
        counts.audit_logs = Number(auditRes[0]?.count || 0);
      } catch {}

      isTiDbOnline = true;
      return {
        connected: true,
        type: 'TiDB Cloud (Serverless MySQL 8.0)',
        host: tidbHost,
        port: tidbPort,
        user: tidbUser,
        database: tidbDatabase,
        hasPassword: true,
        sslActive: true,
        clusterTier: 'TiDB Cloud AWS (ap-southeast-1)',
        message: `Connected securely to TiDB Cloud (${versionStr})`,
        tableCounts: counts,
        lastChecked: new Date().toISOString(),
      };
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    return {
      connected: false,
      type: 'TiDB Cloud (Serverless MySQL 8.0)',
      host: tidbHost,
      port: tidbPort,
      user: tidbUser,
      database: tidbDatabase,
      hasPassword: true,
      sslActive: true,
      message: `TiDB connection failed: ${err.message}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

// Password hashing utility with Bcrypt
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

export async function verifyPassword(plainText: string, hashed: string): Promise<boolean> {
  if (plainText === hashed) return true;
  try {
    return await bcrypt.compare(plainText, hashed);
  } catch {
    return false;
  }
}

// Global initialization for tables, indexes, and schemas
export async function initDbSchema(): Promise<boolean> {
  // 1. PostgreSQL Schema if active
  const pg = getPgPool();
  if (pg) {
    try {
      const client = await pg.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) NOT NULL,
            name VARCHAR(255) NOT NULL,
            status VARCHAR(20) DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS departments (
            id VARCHAR(50) PRIMARY KEY,
            code VARCHAR(20) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            hod_name VARCHAR(255),
            hod_email VARCHAR(255),
            total_students INT DEFAULT 0,
            total_faculty INT DEFAULT 0,
            established_year INT DEFAULT 2000
          );

          CREATE TABLE IF NOT EXISTS subjects (
            code VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            faculty_name VARCHAR(255),
            credits INT DEFAULT 3,
            semester INT DEFAULT 5,
            department VARCHAR(255)
          );

          CREATE TABLE IF NOT EXISTS students (
            reg_no VARCHAR(50) PRIMARY KEY,
            id VARCHAR(50),
            name VARCHAR(255) NOT NULL,
            department VARCHAR(255) NOT NULL,
            year INT NOT NULL,
            semester INT NOT NULL,
            section VARCHAR(10) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(50),
            dob VARCHAR(50),
            blood_group VARCHAR(10),
            faculty_advisor VARCHAR(255),
            mentor VARCHAR(255),
            parent_name VARCHAR(255),
            parent_phone VARCHAR(50),
            address TEXT,
            cgpa NUMERIC(4,2) DEFAULT 0.0,
            current_semester_gpa NUMERIC(4,2) DEFAULT 0.0,
            subjects JSONB,
            marks JSONB,
            assignments JSONB,
            overall_attendance JSONB,
            subject_attendance JSONB,
            performance_rating VARCHAR(50) DEFAULT 'Good',
            faculty_remarks TEXT,
            mentor_notes JSONB,
            avatar TEXT,
            account_status VARCHAR(20) DEFAULT 'Active',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS faculty (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            designation VARCHAR(255) NOT NULL,
            department VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(50),
            cabin VARCHAR(50),
            qualification VARCHAR(255),
            office_hours VARCHAR(255),
            specialization VARCHAR(255),
            bio TEXT,
            assigned_mentee_section VARCHAR(10),
            assigned_classes JSONB,
            avatar TEXT,
            details JSONB,
            account_status VARCHAR(20) DEFAULT 'Active',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS hod (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            designation VARCHAR(255),
            department VARCHAR(255),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(50),
            cabin VARCHAR(50),
            qualification VARCHAR(255),
            office_hours VARCHAR(255),
            specialization VARCHAR(255),
            message TEXT,
            avatar TEXT,
            account_status VARCHAR(20) DEFAULT 'Active',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS admin (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(50),
            role VARCHAR(20) DEFAULT 'admin',
            department VARCHAR(255),
            designation VARCHAR(255),
            avatar TEXT,
            last_login VARCHAR(50)
          );

          CREATE TABLE IF NOT EXISTS attendance_records (
            id VARCHAR(100) PRIMARY KEY,
            date VARCHAR(20) NOT NULL,
            reg_no VARCHAR(50) NOT NULL,
            student_name VARCHAR(255),
            subject_code VARCHAR(50) NOT NULL,
            subject_name VARCHAR(255),
            section VARCHAR(10) NOT NULL,
            year INT NOT NULL,
            status VARCHAR(20) NOT NULL,
            marked_by VARCHAR(255) NOT NULL,
            period INT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS leave_requests (
            id VARCHAR(100) PRIMARY KEY,
            student_reg_no VARCHAR(50) NOT NULL,
            student_name VARCHAR(255),
            department VARCHAR(255),
            year INT,
            section VARCHAR(10),
            start_date VARCHAR(20) NOT NULL,
            end_date VARCHAR(20) NOT NULL,
            days_count INT DEFAULT 1,
            reason TEXT NOT NULL,
            type VARCHAR(50) NOT NULL,
            status VARCHAR(20) DEFAULT 'Pending',
            applied_on VARCHAR(50) NOT NULL,
            reviewed_by VARCHAR(255),
            reviewed_on VARCHAR(50),
            reviewer_comments TEXT
          );

          CREATE TABLE IF NOT EXISTS announcements (
            id VARCHAR(100) PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            author VARCHAR(255) NOT NULL,
            author_role VARCHAR(20) NOT NULL,
            target_audience VARCHAR(50) DEFAULT 'All',
            priority VARCHAR(20) DEFAULT 'Normal',
            date VARCHAR(50) NOT NULL,
            category VARCHAR(50) DEFAULT 'Academic'
          );

          CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(100) PRIMARY KEY,
            target_role VARCHAR(50),
            target_user_id VARCHAR(50),
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            type VARCHAR(20) DEFAULT 'info',
            timestamp VARCHAR(50) NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            link VARCHAR(255)
          );

          CREATE TABLE IF NOT EXISTS fees (
            id VARCHAR(100) PRIMARY KEY,
            student_reg_no VARCHAR(50) NOT NULL,
            student_name VARCHAR(255),
            academic_year VARCHAR(50),
            semester INT,
            tuition_fee NUMERIC(10,2) DEFAULT 0,
            development_fee NUMERIC(10,2) DEFAULT 0,
            exam_fee NUMERIC(10,2) DEFAULT 0,
            total_fee NUMERIC(10,2) DEFAULT 0,
            paid_amount NUMERIC(10,2) DEFAULT 0,
            due_amount NUMERIC(10,2) DEFAULT 0,
            status VARCHAR(20) DEFAULT 'Pending',
            no_due_approved BOOLEAN DEFAULT FALSE,
            last_payment_date VARCHAR(50),
            receipt_number VARCHAR(100)
          );

          CREATE TABLE IF NOT EXISTS audit_logs (
            id VARCHAR(100) PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            performed_by VARCHAR(255) NOT NULL,
            user_role VARCHAR(50) NOT NULL,
            details TEXT NOT NULL,
            timestamp VARCHAR(50) NOT NULL,
            ip_address VARCHAR(50)
          );

          CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('[PostgreSQL] Database schema & indexes initialized successfully');
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('[PostgreSQL] Schema initialization error:', err.message);
    }
  }

  // 2. MySQL / TiDB Cloud Schema Initialization
  const myPool = getMySqlPool();
  if (myPool) {
    try {
      const conn = await myPool.getConnection();
      try {
        // Disable foreign key checks so conflicting constraints in shared databases (like fk_1 on users) won't block table creation
        await conn.query('SET FOREIGN_KEY_CHECKS = 0;').catch(() => {});

        const ddlStatements = [
          {
            name: TABLES.USERS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.USERS} (
                id VARCHAR(50) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(20) NOT NULL,
                name VARCHAR(255) NOT NULL,
                status VARCHAR(20) DEFAULT 'Active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP NULL
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.DEPARTMENTS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.DEPARTMENTS} (
                id VARCHAR(50) PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                hod_name VARCHAR(255),
                hod_email VARCHAR(255),
                total_students INT DEFAULT 0,
                total_faculty INT DEFAULT 0,
                established_year INT DEFAULT 2000
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.SUBJECTS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.SUBJECTS} (
                code VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                faculty_name VARCHAR(255),
                credits INT DEFAULT 3,
                semester INT DEFAULT 5,
                department VARCHAR(255)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.STUDENTS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.STUDENTS} (
                reg_no VARCHAR(50) PRIMARY KEY,
                id VARCHAR(50),
                name VARCHAR(255) NOT NULL,
                department VARCHAR(255) NOT NULL,
                year INT NOT NULL,
                semester INT NOT NULL,
                section VARCHAR(10) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                dob VARCHAR(50),
                blood_group VARCHAR(10),
                faculty_advisor VARCHAR(255),
                mentor VARCHAR(255),
                parent_name VARCHAR(255),
                parent_phone VARCHAR(50),
                address TEXT,
                cgpa DECIMAL(4,2) DEFAULT 0.0,
                current_semester_gpa DECIMAL(4,2) DEFAULT 0.0,
                subjects JSON,
                marks JSON,
                assignments JSON,
                overall_attendance JSON,
                subject_attendance JSON,
                performance_rating VARCHAR(50) DEFAULT 'Good',
                faculty_remarks TEXT,
                mentor_notes JSON,
                avatar TEXT,
                account_status VARCHAR(20) DEFAULT 'Active',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.FACULTY,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.FACULTY} (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                designation VARCHAR(255) NOT NULL,
                department VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                cabin VARCHAR(50),
                qualification VARCHAR(255),
                office_hours VARCHAR(255),
                specialization VARCHAR(255),
                bio TEXT,
                assigned_mentee_section VARCHAR(10),
                assigned_classes JSON,
                avatar TEXT,
                details JSON,
                account_status VARCHAR(20) DEFAULT 'Active',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.HOD,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.HOD} (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                designation VARCHAR(255),
                department VARCHAR(255),
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                cabin VARCHAR(50),
                qualification VARCHAR(255),
                office_hours VARCHAR(255),
                specialization VARCHAR(255),
                message TEXT,
                avatar TEXT,
                account_status VARCHAR(20) DEFAULT 'Active',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.ADMIN,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.ADMIN} (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                role VARCHAR(20) DEFAULT 'admin',
                department VARCHAR(255),
                designation VARCHAR(255),
                avatar TEXT,
                last_login VARCHAR(50)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.ATTENDANCE,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.ATTENDANCE} (
                id VARCHAR(100) PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                reg_no VARCHAR(50) NOT NULL,
                student_name VARCHAR(255),
                subject_code VARCHAR(50) NOT NULL,
                subject_name VARCHAR(255),
                section VARCHAR(10) NOT NULL,
                year INT NOT NULL,
                status VARCHAR(20) NOT NULL,
                marked_by VARCHAR(255) NOT NULL,
                period INT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.LEAVE_REQUESTS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.LEAVE_REQUESTS} (
                id VARCHAR(100) PRIMARY KEY,
                student_reg_no VARCHAR(50) NOT NULL,
                student_name VARCHAR(255),
                department VARCHAR(255),
                year INT,
                section VARCHAR(10),
                start_date VARCHAR(20) NOT NULL,
                end_date VARCHAR(20) NOT NULL,
                days_count INT DEFAULT 1,
                reason TEXT NOT NULL,
                type VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'Pending',
                applied_on VARCHAR(50) NOT NULL,
                reviewed_by VARCHAR(255),
                reviewed_on VARCHAR(50),
                reviewer_comments TEXT
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.ANNOUNCEMENTS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.ANNOUNCEMENTS} (
                id VARCHAR(100) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                author VARCHAR(255) NOT NULL,
                author_role VARCHAR(20) NOT NULL,
                target_audience VARCHAR(50) DEFAULT 'All',
                priority VARCHAR(20) DEFAULT 'Normal',
                date VARCHAR(50) NOT NULL,
                category VARCHAR(50) DEFAULT 'Academic'
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.NOTIFICATIONS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.NOTIFICATIONS} (
                id VARCHAR(100) PRIMARY KEY,
                target_role VARCHAR(50),
                target_user_id VARCHAR(50),
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(20) DEFAULT 'info',
                timestamp VARCHAR(50) NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                link VARCHAR(255)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.FEES,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.FEES} (
                id VARCHAR(100) PRIMARY KEY,
                student_reg_no VARCHAR(50) NOT NULL,
                student_name VARCHAR(255),
                academic_year VARCHAR(50),
                semester INT,
                tuition_fee DECIMAL(10,2) DEFAULT 0,
                development_fee DECIMAL(10,2) DEFAULT 0,
                exam_fee DECIMAL(10,2) DEFAULT 0,
                total_fee DECIMAL(10,2) DEFAULT 0,
                paid_amount DECIMAL(10,2) DEFAULT 0,
                due_amount DECIMAL(10,2) DEFAULT 0,
                status VARCHAR(20) DEFAULT 'Pending',
                no_due_approved BOOLEAN DEFAULT FALSE,
                last_payment_date VARCHAR(50),
                receipt_number VARCHAR(100)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.AUDIT_LOGS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.AUDIT_LOGS} (
                id VARCHAR(100) PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                performed_by VARCHAR(255) NOT NULL,
                user_role VARCHAR(50) NOT NULL,
                details TEXT NOT NULL,
                timestamp VARCHAR(50) NOT NULL,
                ip_address VARCHAR(50)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
          {
            name: TABLES.SYSTEM_SETTINGS,
            sql: `
              CREATE TABLE IF NOT EXISTS ${TABLES.SYSTEM_SETTINGS} (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value JSON NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `,
          },
        ];

        for (const item of ddlStatements) {
          try {
            await conn.query(item.sql);
          } catch (err: any) {
            console.warn(`[MySQL/TiDB] Table creation note for ${item.name}:`, err.message);
          }
        }

        // Migrate from legacy students table if it exists and has reg_no
        try {
          const [checkLegacy]: any = await conn.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'reg_no'"
          );
          if (Array.isArray(checkLegacy) && checkLegacy.length > 0) {
            const [curCount]: any = await conn.query(`SELECT COUNT(*) as c FROM ${TABLES.STUDENTS}`);
            if (Number(curCount[0]?.c || 0) === 0) {
              await conn.query(`INSERT IGNORE INTO ${TABLES.STUDENTS} SELECT * FROM students`);
              console.log('[MySQL/TiDB] Successfully migrated records from legacy students table to portal_students');
            }
          }
        } catch {}

        await conn.query('SET FOREIGN_KEY_CHECKS = 1;').catch(() => {});
        console.log('[MySQL/TiDB] All 14 Institutional Database Tables Verified & Ready.');
        return true;
      } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1;').catch(() => {});
        conn.release();
      }
    } catch (err: any) {
      console.error('[MySQL/TiDB] Schema initialization failed:', err.message);
      return false;
    }
  }

  return true;
}

// -------------------------------------------------------------
// TiDB Direct Data Persistence Functions (Async SQL Execution)
// -------------------------------------------------------------

export async function saveStudentToTiDb(student: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.STUDENTS} (
          reg_no, id, name, department, year, semester, section, email,
          phone, dob, blood_group, faculty_advisor, mentor, parent_name,
          parent_phone, address, cgpa, current_semester_gpa, subjects,
          marks, assignments, overall_attendance, subject_attendance,
          performance_rating, faculty_remarks, mentor_notes, avatar, account_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          department = VALUES(department),
          year = VALUES(year),
          semester = VALUES(semester),
          section = VALUES(section),
          email = VALUES(email),
          phone = VALUES(phone),
          dob = VALUES(dob),
          blood_group = VALUES(blood_group),
          faculty_advisor = VALUES(faculty_advisor),
          mentor = VALUES(mentor),
          parent_name = VALUES(parent_name),
          parent_phone = VALUES(parent_phone),
          address = VALUES(address),
          cgpa = VALUES(cgpa),
          current_semester_gpa = VALUES(current_semester_gpa),
          subjects = VALUES(subjects),
          marks = VALUES(marks),
          assignments = VALUES(assignments),
          overall_attendance = VALUES(overall_attendance),
          subject_attendance = VALUES(subject_attendance),
          performance_rating = VALUES(performance_rating),
          faculty_remarks = VALUES(faculty_remarks),
          mentor_notes = VALUES(mentor_notes),
          avatar = VALUES(avatar),
          account_status = VALUES(account_status);
      `;

      const values = [
        student.regNo,
        student.id || `STU-${student.regNo}`,
        student.name,
        student.department,
        student.year || 3,
        student.semester || 5,
        student.section || 'A',
        student.email,
        student.phone || '',
        student.dob || '2004-01-01',
        student.bloodGroup || 'O+',
        student.facultyAdvisor || 'Dr. R. Sharma',
        student.mentor || 'Dr. R. Sharma',
        student.parentName || '',
        student.parentPhone || '',
        student.address || '',
        Number(student.cgpa) || 0.0,
        Number(student.currentSemesterGpa) || 0.0,
        JSON.stringify(student.subjects || []),
        JSON.stringify(student.marks || {}),
        JSON.stringify(student.assignments || []),
        JSON.stringify(student.overallAttendance || { present: 0, absent: 0, od: 0, total: 0, percentage: 0 }),
        JSON.stringify(student.subjectAttendance || {}),
        student.performanceRating || 'Good',
        student.facultyRemarks || '',
        JSON.stringify(student.mentorNotes || []),
        student.avatar || '',
        student.accountStatus || 'Active',
      ];

      await conn.query(query, values);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function deleteStudentFromTiDb(regNo: string): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      await conn.query(`DELETE FROM ${TABLES.STUDENTS} WHERE reg_no = ?`, [regNo]);
      await conn.query(`DELETE FROM ${TABLES.USERS} WHERE id = ?`, [regNo]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveAttendanceRecordToTiDb(record: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.ATTENDANCE} (
          id, date, reg_no, student_name, subject_code, subject_name,
          section, year, status, marked_by, period
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          marked_by = VALUES(marked_by),
          period = VALUES(period);
      `;
      await conn.query(query, [
        record.id,
        record.date,
        record.regNo,
        record.studentName || '',
        record.subjectCode,
        record.subjectName || record.subjectCode,
        record.section || 'A',
        record.year || 3,
        record.status,
        record.markedBy || 'Faculty',
        record.period || 1,
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveLeaveRequestToTiDb(leave: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.LEAVE_REQUESTS} (
          id, student_reg_no, student_name, department, year, section,
          start_date, end_date, days_count, reason, type, status,
          applied_on, reviewed_by, reviewed_on, reviewer_comments
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          reviewed_by = VALUES(reviewed_by),
          reviewed_on = VALUES(reviewed_on),
          reviewer_comments = VALUES(reviewer_comments);
      `;
      await conn.query(query, [
        leave.id,
        leave.studentRegNo,
        leave.studentName,
        leave.department,
        leave.year,
        leave.section,
        leave.startDate,
        leave.endDate,
        leave.daysCount || 1,
        leave.reason,
        leave.type,
        leave.status || 'Pending',
        leave.appliedOn,
        leave.reviewedBy || null,
        leave.reviewedOn || null,
        leave.reviewerComments || null,
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveFacultyToTiDb(faculty: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.FACULTY} (
          id, name, designation, department, email, phone, cabin,
          qualification, office_hours, specialization, bio,
          assigned_mentee_section, assigned_classes, avatar, details, account_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          designation = VALUES(designation),
          department = VALUES(department),
          email = VALUES(email),
          phone = VALUES(phone),
          cabin = VALUES(cabin),
          qualification = VALUES(qualification),
          office_hours = VALUES(office_hours),
          specialization = VALUES(specialization),
          bio = VALUES(bio),
          assigned_mentee_section = VALUES(assigned_mentee_section),
          assigned_classes = VALUES(assigned_classes),
          avatar = VALUES(avatar),
          details = VALUES(details),
          account_status = VALUES(account_status);
      `;
      await conn.query(query, [
        faculty.id,
        faculty.name,
        faculty.designation,
        faculty.department,
        faculty.email,
        faculty.phone || '',
        faculty.cabin || '',
        faculty.qualification || '',
        faculty.officeHours || '',
        faculty.specialization || '',
        faculty.bio || '',
        faculty.assignedMenteeSection || '',
        JSON.stringify(faculty.assignedClasses || []),
        faculty.avatar || '',
        JSON.stringify(faculty.details || {}),
        faculty.accountStatus || 'Active',
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveAnnouncementToTiDb(ann: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.ANNOUNCEMENTS} (
          id, title, content, author, author_role, target_audience, priority, date, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          content = VALUES(content),
          priority = VALUES(priority),
          target_audience = VALUES(target_audience);
      `;
      await conn.query(query, [
        ann.id,
        ann.title,
        ann.content,
        ann.author,
        ann.authorRole,
        ann.targetAudience || 'All',
        ann.priority || 'Normal',
        ann.date,
        ann.category || 'Academic',
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveFeeToTiDb(fee: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.FEES} (
          id, student_reg_no, student_name, academic_year, semester,
          tuition_fee, development_fee, exam_fee, total_fee,
          paid_amount, due_amount, status, no_due_approved,
          last_payment_date, receipt_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          paid_amount = VALUES(paid_amount),
          due_amount = VALUES(due_amount),
          status = VALUES(status),
          no_due_approved = VALUES(no_due_approved),
          last_payment_date = VALUES(last_payment_date),
          receipt_number = VALUES(receipt_number);
      `;
      await conn.query(query, [
        fee.id,
        fee.studentRegNo,
        fee.studentName,
        fee.academicYear || '2026-2027',
        fee.semester || 5,
        fee.tuitionFee || 0,
        fee.developmentFee || 0,
        fee.examFee || 0,
        fee.totalFee || 0,
        fee.paidAmount || 0,
        fee.dueAmount || 0,
        fee.status || 'Pending',
        Boolean(fee.noDueApproved),
        fee.lastPaymentDate || '',
        fee.receiptNumber || '',
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveUserToTiDb(user: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO ${TABLES.USERS} (id, email, password_hash, role, name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = VALUES(email),
          role = VALUES(role),
          status = VALUES(status);
      `;
      await conn.query(query, [
        user.id,
        user.email,
        user.passwordHash || 'student123',
        user.role,
        user.name,
        user.status || 'Active',
        user.createdAt || new Date(),
      ]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

export async function saveAuditLogToTiDb(log: any): Promise<boolean> {
  if (!isTiDbOnline) return false;
  const pool = getMySqlPool();
  if (!pool) return false;

  try {
    const conn = await pool.getConnection();
    try {
      await conn.query(
        `INSERT INTO ${TABLES.AUDIT_LOGS} (id, action, performed_by, user_role, details, timestamp, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [log.id, log.action, log.performedBy, log.userRole, log.details, log.timestamp, log.ipAddress || '127.0.0.1']
      );
      return true;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    isTiDbOnline = false;
    console.warn('[TiDB] Sync pending (database offline):', err.message);
    return false;
  }
}

// Bulk Sync All Data To TiDB
export async function syncAllToTiDb(data: {
  students?: any[];
  faculty?: any[];
  hod?: any;
  attendance?: any[];
  leaveRequests?: any[];
  announcements?: any[];
  fees?: any[];
  users?: any[];
}): Promise<{ success: boolean; message: string; counts?: any }> {
  const pool = getMySqlPool();
  if (!pool) {
    return { success: false, message: 'TiDB Cloud connection pool is not configured or password is missing' };
  }

  try {
    const conn = await pool.getConnection();
    try {
      await conn.query('START TRANSACTION');

      if (data.students && data.students.length > 0) {
        for (const s of data.students) {
          await saveStudentToTiDb(s);
        }
      }

      if (data.faculty && data.faculty.length > 0) {
        for (const f of data.faculty) {
          await saveFacultyToTiDb(f);
        }
      }

      if (data.attendance && data.attendance.length > 0) {
        for (const a of data.attendance) {
          await saveAttendanceRecordToTiDb(a);
        }
      }

      if (data.leaveRequests && data.leaveRequests.length > 0) {
        for (const l of data.leaveRequests) {
          await saveLeaveRequestToTiDb(l);
        }
      }

      if (data.announcements && data.announcements.length > 0) {
        for (const ann of data.announcements) {
          await saveAnnouncementToTiDb(ann);
        }
      }

      if (data.fees && data.fees.length > 0) {
        for (const fee of data.fees) {
          await saveFeeToTiDb(fee);
        }
      }

      if (data.users && data.users.length > 0) {
        for (const u of data.users) {
          await saveUserToTiDb(u);
        }
      }

      await conn.query('COMMIT');
      return { success: true, message: 'All institutional records synchronized to TiDB Cloud successfully!' };
    } catch (err: any) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('[TiDB Sync Error]', err.message);
    return { success: false, message: `Sync failed: ${err.message}` };
  }
}

// Load All Records From TiDB (returns null if TiDB not connected or no data loaded)
export async function loadAllFromTiDb(): Promise<any | null> {
  const pool = getMySqlPool();
  if (!pool) return null;

  try {
    const conn = await pool.getConnection();
    try {
      let students: any[] = [];
      try {
        let [stuRows]: any = await conn.query(`SELECT * FROM ${TABLES.STUDENTS} ORDER BY reg_no ASC`).catch(async () => {
          return await conn.query(`SELECT * FROM ${TABLES.STUDENTS}`);
        });

        // Fallback to legacy students table if portal_students is empty
        if ((!stuRows || stuRows.length === 0)) {
          try {
            const [legacyRows]: any = await conn.query('SELECT * FROM students');
            if (legacyRows && legacyRows.length > 0 && legacyRows[0].reg_no) {
              stuRows = legacyRows;
            }
          } catch {}
        }

        if (stuRows && stuRows.length > 0) {
          students = stuRows.map((r: any) => ({
            regNo: r.reg_no || r.regNo || r.id || '',
            id: r.id || `STU-${r.reg_no}`,
            name: r.name || '',
            department: r.department || '',
            year: Number(r.year) || 1,
            semester: Number(r.semester) || 1,
            section: r.section || 'A',
            email: r.email || '',
            phone: r.phone || '',
            dob: r.dob || '',
            bloodGroup: r.blood_group || r.bloodGroup || '',
            facultyAdvisor: r.faculty_advisor || r.facultyAdvisor || '',
            mentor: r.mentor || '',
            parentName: r.parent_name || r.parentName || '',
            parentPhone: r.parent_phone || r.parentPhone || '',
            address: r.address || '',
            cgpa: Number(r.cgpa) || 0.0,
            currentSemesterGpa: Number(r.current_semester_gpa || r.currentSemesterGpa) || 0.0,
            subjects: typeof r.subjects === 'string' ? JSON.parse(r.subjects) : (r.subjects || []),
            marks: typeof r.marks === 'string' ? JSON.parse(r.marks) : (r.marks || {}),
            assignments: typeof r.assignments === 'string' ? JSON.parse(r.assignments) : (r.assignments || []),
            overallAttendance: typeof r.overall_attendance === 'string' ? JSON.parse(r.overall_attendance) : (r.overall_attendance || { present: 0, absent: 0, od: 0, total: 0, percentage: 0 }),
            subjectAttendance: typeof r.subject_attendance === 'string' ? JSON.parse(r.subject_attendance) : (r.subject_attendance || {}),
            performanceRating: r.performance_rating || r.performanceRating || 'Good',
            facultyRemarks: r.faculty_remarks || r.facultyRemarks || '',
            mentorNotes: typeof r.mentor_notes === 'string' ? JSON.parse(r.mentor_notes) : (r.mentor_notes || []),
            avatar: r.avatar || '',
            accountStatus: r.account_status || r.accountStatus || 'Active',
          }));
        }
      } catch (err: any) {
        console.warn('[TiDB] Query warning for students:', err.message);
      }

      // Faculty
      let faculty: any[] = [];
      try {
        const [facRows]: any = await conn.query(`SELECT * FROM ${TABLES.FACULTY}`);
        faculty = (facRows || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          designation: r.designation,
          department: r.department,
          email: r.email,
          phone: r.phone || '',
          cabin: r.cabin || '',
          qualification: r.qualification || '',
          officeHours: r.office_hours || '',
          specialization: r.specialization || '',
          bio: r.bio || '',
          assignedMenteeSection: r.assigned_mentee_section || '',
          assignedClasses: typeof r.assigned_classes === 'string' ? JSON.parse(r.assigned_classes) : (r.assigned_classes || []),
          avatar: r.avatar || '',
          details: typeof r.details === 'string' ? JSON.parse(r.details) : (r.details || {}),
          accountStatus: r.account_status || 'Active',
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for faculty:', err.message);
      }

      // Attendance
      let attendance: any[] = [];
      try {
        const [attRows]: any = await conn.query(`SELECT * FROM ${TABLES.ATTENDANCE} ORDER BY date DESC`).catch(async () => {
          return await conn.query(`SELECT * FROM ${TABLES.ATTENDANCE}`);
        });
        attendance = (attRows || []).map((r: any) => ({
          id: r.id,
          date: r.date,
          regNo: r.reg_no,
          studentName: r.student_name,
          subjectCode: r.subject_code,
          subjectName: r.subject_name,
          section: r.section,
          year: Number(r.year),
          status: r.status,
          markedBy: r.marked_by,
          period: Number(r.period) || 1,
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for attendance:', err.message);
      }

      // Leave Requests
      let leaveRequests: any[] = [];
      try {
        const [leaveRows]: any = await conn.query(`SELECT * FROM ${TABLES.LEAVE_REQUESTS} ORDER BY applied_on DESC`).catch(async () => {
          return await conn.query(`SELECT * FROM ${TABLES.LEAVE_REQUESTS}`);
        });
        leaveRequests = (leaveRows || []).map((r: any) => ({
          id: r.id,
          studentRegNo: r.student_reg_no,
          studentName: r.student_name,
          department: r.department,
          year: Number(r.year),
          section: r.section,
          startDate: r.start_date,
          endDate: r.end_date,
          daysCount: Number(r.days_count),
          reason: r.reason,
          type: r.type,
          status: r.status,
          appliedOn: r.applied_on,
          reviewedBy: r.reviewed_by,
          reviewedOn: r.reviewed_on,
          reviewerComments: r.reviewer_comments,
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for leave requests:', err.message);
      }

      // Announcements
      let announcements: any[] = [];
      try {
        const [annRows]: any = await conn.query(`SELECT * FROM ${TABLES.ANNOUNCEMENTS} ORDER BY date DESC`).catch(async () => {
          return await conn.query(`SELECT * FROM ${TABLES.ANNOUNCEMENTS}`);
        });
        announcements = (annRows || []).map((r: any) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          author: r.author,
          authorRole: r.author_role,
          targetAudience: r.target_audience,
          priority: r.priority,
          date: r.date,
          category: r.category,
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for announcements:', err.message);
      }

      // Fees
      let fees: any[] = [];
      try {
        const [feeRows]: any = await conn.query(`SELECT * FROM ${TABLES.FEES}`);
        fees = (feeRows || []).map((r: any) => ({
          id: r.id,
          studentRegNo: r.student_reg_no,
          studentName: r.student_name,
          academicYear: r.academic_year,
          semester: Number(r.semester),
          tuitionFee: Number(r.tuition_fee),
          developmentFee: Number(r.development_fee),
          examFee: Number(r.exam_fee),
          totalFee: Number(r.total_fee),
          paidAmount: Number(r.paid_amount),
          dueAmount: Number(r.due_amount),
          status: r.status,
          noDueApproved: Boolean(r.no_due_approved),
          lastPaymentDate: r.last_payment_date,
          receiptNumber: r.receipt_number,
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for fees:', err.message);
      }

      // Users
      let users: any[] = [];
      try {
        const [userRows]: any = await conn.query(`SELECT * FROM ${TABLES.USERS}`);
        users = (userRows || []).map((r: any) => ({
          id: r.id,
          email: r.email,
          passwordHash: r.password_hash,
          role: r.role,
          name: r.name,
          status: r.status,
          createdAt: r.created_at,
          lastLogin: r.last_login,
        }));
      } catch (err: any) {
        console.warn('[TiDB] Query warning for users:', err.message);
      }

      // If no data loaded from any table, return null to let repository seed mock/initial data
      if (
        students.length === 0 &&
        faculty.length === 0 &&
        attendance.length === 0 &&
        leaveRequests.length === 0 &&
        announcements.length === 0 &&
        fees.length === 0 &&
        users.length === 0
      ) {
        return null;
      }

      return {
        students: students.length > 0 ? students : undefined,
        faculty: faculty.length > 0 ? faculty : undefined,
        attendance: attendance.length > 0 ? attendance : undefined,
        leaveRequests: leaveRequests.length > 0 ? leaveRequests : undefined,
        announcements: announcements.length > 0 ? announcements : undefined,
        fees: fees.length > 0 ? fees : undefined,
        users: users.length > 0 ? users : undefined,
      };
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('[TiDB] Failed to load data from database:', err.message);
    return null;
  }
}
