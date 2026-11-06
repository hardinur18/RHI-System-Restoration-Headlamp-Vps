import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import cekatAvailabilityRoute from "../server/cekat_availability.tsx";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "x-client-token", "X-Client-Token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.route("/cekat-availability", cekatAvailabilityRoute);

Deno.serve(app.fetch);
