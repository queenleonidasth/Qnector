import type { WebSocket } from "ws";

export interface DeviceConnection {
  deviceId: string;
  version: string;
  connectedAt: string;
  socket: WebSocket;
}

export class DeviceRegistry {
  private readonly devices = new Map<string, DeviceConnection>();

  public register(
    deviceId: string,
    version: string,
    socket: WebSocket,
  ): DeviceConnection {
    this.devices
      .get(deviceId)
      ?.socket.close(1000, "replaced by a new connection");
    const connection = {
      deviceId,
      version,
      connectedAt: new Date().toISOString(),
      socket,
    };
    this.devices.set(deviceId, connection);
    socket.once("close", () => {
      if (this.devices.get(deviceId)?.socket === socket)
        this.devices.delete(deviceId);
    });
    return connection;
  }

  public get(deviceId: string): DeviceConnection | undefined {
    const connection = this.devices.get(deviceId);
    if (!connection || connection.socket.readyState !== 1 /* WebSocket.OPEN */)
      return undefined;
    return connection;
  }

  public status(deviceId: string): Record<string, unknown> {
    const connection = this.get(deviceId);
    return connection
      ? {
          deviceId,
          connected: true,
          version: connection.version,
          connectedAt: connection.connectedAt,
        }
      : { deviceId, connected: false };
  }

  public closeAll(): void {
    for (const connection of this.devices.values())
      connection.socket.close(1000, "relay shutting down");
    this.devices.clear();
  }
}
