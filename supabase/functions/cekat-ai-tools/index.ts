import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import cekatAiToolsRoute from "../server/cekat_ai_tools.tsx";

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

app.route("/cekat-ai-tools", cekatAiToolsRoute);

Deno.serve(app.fetch);
