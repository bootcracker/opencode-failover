import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const { server } = startServer({ port, host });

server.listen(port, host, () => {
  console.log(`opencode-failover listening on http://${host}:${port}`);
});
