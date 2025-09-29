import Cors from "cors";
import initMiddleware from "./init-middleware";
import type { NextApiResponse } from "next";

const rawOrigins = process.env.CORS_ORIGINS || "";
const allowedOrigins =
  rawOrigins === "*" ? "*" : rawOrigins.split(",").map((o) => o.trim());

export const cors = initMiddleware(
  Cors({
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
    preflightContinue: false,
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      console.log("---- CORS DEBUG ----");
      console.log("Request origin:", origin);
      console.log("Allowed origins:", allowedOrigins);

      if (!origin) {
        console.log("No origin provided. Allowing by default.");
        return callback(null, true);
      }
      if (allowedOrigins === "*") {
        console.log("Wildcard origin match. Allowing all.");
        return callback(null, true);
      }
      
      // Check for exact match first
      if (allowedOrigins.includes(origin)) {
        console.log("Exact origin match. Allowing.");
        return callback(null, true);
      }
      
      // Check for subdomain matches
      for (const allowedOrigin of allowedOrigins) {
        try {
          const allowedUrl = new URL(allowedOrigin);
          const requestUrl = new URL(origin);
          
          // Check if the request origin is a subdomain of the allowed origin
          if (requestUrl.hostname.endsWith('.' + allowedUrl.hostname) || 
              requestUrl.hostname === allowedUrl.hostname) {
            console.log(`Subdomain match: ${origin} matches allowed origin ${allowedOrigin}`);
            return callback(null, true);
          }
        } catch (error) {
          console.warn(`Invalid URL format for origin: ${allowedOrigin}`, error);
        }
      }
      
      console.error(`Origin ${origin} not allowed by CORS`);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);

// Helper function to add cache-busting headers for CORS
export function addCorsCacheBustingHeaders(res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Origin');
}
