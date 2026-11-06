import app from "../server/cekat_conversation_sync.tsx";

Deno.serve(app.fetch);
