import type { AddressInfo } from "node:net";
import { createProxy } from "./app.ts";

const port = Number(process.env.PORT ?? 4100);
const { app } = createProxy({
  log: { info: (o) => console.log(JSON.stringify(o)), warn: (o) => console.warn(JSON.stringify(o)) },
});
const server = app.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ msg: "proxy listening", port: (server.address() as AddressInfo).port }));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
