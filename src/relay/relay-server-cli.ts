#!/usr/bin/env node

import {
  startDeskRelayRelayServer,
} from "./relay-server.ts";

export type RelayServerCliOptions = {
  host: string;
  port: number;
  deviceId: string;
  deviceToken: string;
};

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseRelayServerCliOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): RelayServerCliOptions {
  const host = readOption(args, "--host")?.trim() ||
    env.DESKRELAY_RELAY_HOST?.trim() ||
    "127.0.0.1";
  const rawPort = readOption(args, "--port")?.trim() ||
    env.DESKRELAY_RELAY_PORT?.trim() ||
    "14396";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Relay 监听端口无效。");
  }
  const deviceId = readOption(args, "--device-id")?.trim() ||
    env.DESKRELAY_RELAY_DEVICE_ID?.trim() ||
    "default";
  const deviceToken = env.DESKRELAY_RELAY_DEVICE_TOKEN?.trim() || "";
  if (!deviceToken) {
    throw new Error("缺少 DESKRELAY_RELAY_DEVICE_TOKEN，Relay 无法启动。");
  }
  return { host, port, deviceId, deviceToken };
}

export async function main(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseRelayServerCliOptions(args);
  const server = await startDeskRelayRelayServer({
    ...options,
    logger: (message) => process.stderr.write(`[DeskRelay Relay] ${message}\n`),
  });
  process.stdout.write(
    `DeskRelay Relay 已启动：http://${server.host}:${server.port}\n`,
  );

  let closing = false;
  const close = (signal: string) => {
    if (closing) {
      return;
    }
    closing = true;
    process.stdout.write(`收到 ${signal}，正在停止 DeskRelay Relay。\n`);
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => close("SIGINT"));
  process.on("SIGTERM", () => close("SIGTERM"));
  process.on("SIGHUP", () => close("SIGHUP"));

  await new Promise<void>(() => undefined);
}

const isDirectRun = Boolean((import.meta as ImportMeta & { main?: boolean }).main);
if (isDirectRun) {
  void main();
}
