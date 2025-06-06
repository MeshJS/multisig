import Cors from 'cors';
import initMiddleware from './init-middleware';

const rawOrigins = process.env.CORS_ORIGINS || '';
const allowedOrigins = rawOrigins === '*' ? '*' : rawOrigins.split(',').map(o => o.trim());

export const cors = initMiddleware(
  Cors({
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) {
      if (!origin) return callback(null, true);
      if (allowedOrigins === '*') return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    }
  })
);