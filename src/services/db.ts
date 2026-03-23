import sql from 'mssql';

const config: sql.config = {
  server: process.env.DATABASE_HOST || '',
  port: parseInt(process.env.DATABASE_PORT || '1433'),
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USERNAME || '',
  password: process.env.DATABASE_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    if (!config.password) {
      throw new Error('DATABASE_PASSWORD environment variable is required');
    }
    pool = await sql.connect(config);
    console.log('[DB] Connected to database');
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[DB] Database connection closed');
  }
}

export { sql };
