import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

function canListen(): (host?: string) => Promise<number> {
  return (host) =>
    new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      const onListen = () => {
        const assigned = (s.address() as AddressInfo).port;
        s.close((err) => (err ? reject(err) : resolve(assigned)));
      };
      if (host) {
        s.listen(0, host, onListen);
      } else {
        s.listen(0, onListen);
      }
    });
}

export async function getFreePort(): Promise<number> {
  const getPort = canListen();
  while (true) {
    let port: number;
    try {
      port = await getPort("127.0.0.1");
    } catch (err) {
      if (
        !(typeof err === "object" && err !== null && (err as { code?: string }).code === "EPERM")
      ) {
        throw err;
      }
      port = await getPort();
    }
    if (port < 65535) {
      return port;
    }
  }
}
