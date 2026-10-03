import { loadContent } from "./content.ts";
import { createServer } from "./app.ts";

const port = Number(process.env.PORT ?? 2567);
const content = loadContent();
const server = createServer(content);
await server.listen(port, "0.0.0.0");
console.log(`SuperWorld game server listening on :${port}`);
