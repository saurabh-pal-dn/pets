/**
 * PetDisplayServer — runs inside the pi extension.
 * Serves animation frames over a Unix socket to the pet display client.
 */

import { createServer } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// ─── Frame protocol ─────────────────────────────────────────

export interface PetDisplayFrame {
  type: "frame";
  /** "image" = Kitty protocol, "text" = ASCII/emoji lines */
  mode: "image" | "text";
  emotion: string;
  // Image mode fields
  base64?: string;
  cols?: number;
  rows?: number;
  imageId?: number;
  // Text mode fields
  textLines?: string[];
  // Status
  happiness: number;
  fullness: number;
  energy: number;
}

export interface PetDisplayCommand {
  type: "clear" | "close";
}

export type PetDisplayMessage = PetDisplayFrame | PetDisplayCommand;

// ─── Server ─────────────────────────────────────────────────

export class PetDisplayServer {
  private socketPath: string;
  private server: ReturnType<typeof createServer> | null = null;
  private clients: Set<
    ReturnType<typeof createServer>["clients"] extends Set<infer T> ? T : never
  > = new Set();
  private onClientConnected?: () => void;
  private onClientDisconnected?: () => void;

  constructor(socketPath?: string) {
    this.socketPath =
      socketPath ??
      join(tmpdir(), `pi-pets-${randomBytes(4).toString("hex")}.sock`);
  }

  get path(): string {
    return this.socketPath;
  }

  get hasClients(): boolean {
    return this.clients.size > 0;
  }

  async start(): Promise<void> {
    // Clean up stale socket
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.clients.add(socket);
        // console.log("[pi-pets] Display client connected");
        this.onClientConnected?.();

        socket.on("close", () => {
          this.clients.delete(socket);
          // console.log("[pi-pets] Display client disconnected");
          this.onClientDisconnected?.();
        });

        socket.on("error", () => {
          this.clients.delete(socket);
          this.onClientDisconnected?.();
        });
      });

      this.server.on("error", reject);
      this.server.listen(this.socketPath, () => {
        // console.log("[pi-pets] Display server listening on", this.socketPath);
        resolve();
      });
    });
  }

  /** Send a frame to all connected clients */
  sendFrame(frame: PetDisplayFrame): void {
    if (this.clients.size === 0) return;
    this.broadcast(frame);
  }

  /** Send close command (client will exit) */
  sendClose(): void {
    this.broadcast({ type: "close" });
  }

  onConnect(cb: () => void): void {
    this.onClientConnected = cb;
  }
  onDisconnect(cb: () => void): void {
    this.onClientDisconnected = cb;
  }

  async stop(): Promise<void> {
    this.sendClose();
    // Give clients a moment to receive the close message
    await new Promise((r) => setTimeout(r, 100));
    this.clients.forEach((s) => s.destroy());
    this.clients.clear();
    this.server?.close();
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }
    console.log("[pi-pets] Display server stopped");
  }

  private broadcast(msg: PetDisplayMessage): void {
    const json = JSON.stringify(msg) + "\n";
    for (const socket of this.clients) {
      try {
        socket.write(json);
      } catch {
        /* client gone */
      }
    }
  }
}
