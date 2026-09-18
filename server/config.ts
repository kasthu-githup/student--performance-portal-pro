import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'park-college-enterprise-secret-key-2026-prod-auth',
  jwtExpiresIn: '7d',
  
  // PostgreSQL Database settings
  pg: {
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST || process.env.SQL_HOST || 'localhost',
    port: Number(process.env.PGPORT || process.env.SQL_PORT || 5432),
    user: process.env.PGUSER || process.env.SQL_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.SQL_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.SQL_DB_NAME || 'postgres',
  },

  // TiDB Cloud (MySQL 8.0) settings
  tidb: {
    host: process.env.TIDB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER || '4DCBaqMJVo1Yjy9.root',
    password: process.env.TIDB_PASSWORD || '',
    database: process.env.TIDB_DATABASE || 'college_nodue',
  },

  // Security & limits
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 500, // max requests per window
  },
  
  institution: {
    name: 'Park College of Engineering and Technology',
    affiliation: 'Autonomous Institution Affiliated to Anna University, Chennai',
    academicYear: '2026-2027',
    currentSemester: 5,
    attendanceThreshold: 75,
  }
};

export function updateTiDbConfig(updates: {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}) {
  if (updates.host !== undefined) config.tidb.host = updates.host;
  if (updates.port !== undefined) config.tidb.port = Number(updates.port);
  if (updates.user !== undefined) config.tidb.user = updates.user;
  if (updates.password !== undefined) config.tidb.password = updates.password;
  if (updates.database !== undefined) config.tidb.database = updates.database;

  // Persist to .env if possible
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

    const setEnvVar = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}="${value}"`);
      } else {
        envContent += `\n${key}="${value}"`;
      }
    };

    if (updates.host) setEnvVar('TIDB_HOST', updates.host);
    if (updates.port) setEnvVar('TIDB_PORT', String(updates.port));
    if (updates.user) setEnvVar('TIDB_USER', updates.user);
    if (updates.password !== undefined) setEnvVar('TIDB_PASSWORD', updates.password);
    if (updates.database) setEnvVar('TIDB_DATABASE', updates.database);

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
  } catch (err: any) {
    console.warn('[Config] Notice persisting to .env:', err.message);
  }
}
