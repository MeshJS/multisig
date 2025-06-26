import Cors from "cors";
import initMiddleware from "./init-middleware";

const rawOrigins = process.env.CORS_ORIGINS || "";
const allowedOrigins =
  rawOrigins === "*" ? "*" : rawOrigins.split(",").map((o) => o.trim());

export const cors = initMiddleware(
  Cors({
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
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
      if (allowedOrigins.includes(origin)) {
        console.log("Origin allowed.");
        return callback(null, true);
      } else {
        console.error(`Origin ${origin} not allowed by CORS`);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
  }),
);
