/**
 * OpenPetsClient — connects to the OpenPets desktop app via Unix socket
 * and sends pet state events. Used as the preferred renderer when OpenPets is installed.
 *
 * Socket path: /tmp/openpets-<uid>/openpets.sock
 * Protocol: JSON-RPC over newline-delimited TCP
 */

import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

// ─── Types ──────────────────────────────────────────────────

export type OpenPetsState =
  | "idle" | "thinking" | "working" | "editing" | "running"
  | "testing" | "waiting" | "waving" | "success" | "error"
  | "warning" | "celebrating" | "sleeping";

export interface OpenPetsEvent {
  type: string;
  state: OpenPetsState;
  source?: string;
  message?: string;
  tool?: string;
}

// ─── Emotion → State mapping ────────────────────────────────

const EMOTION_MAP: Record<string, OpenPetsState> = {
  idle: "idle",
  happy: "celebrating",
  thinking: "thinking",
  working: "working",
  coding: "editing",
  success: "success",
  error: "error",
  sad: "waiting",
  excited: "celebrating",
  sleepy: "sleeping",
  sleeping: "sleeping",
  hungry: "warning",
  curious: "waving",
  shocked: "warning",
  greeting: "waving",
  eating: "idle",
  playing: "celebrating",
};

// ─── Client ─────────────────────────────────────────────────

export class OpenPetsClient {
  private socketPath: string;
  private connected = false;
  private socket: ReturnType<typeof createConnection> | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private reqId = 0;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? OpenPetsClient.defaultSocketPath();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  static defaultSocketPath(): string {
    const uid = userInfo().uid;
    return `/tmp/openpets-${uid}/openpets.sock`;
  }

  static isInstalled(): boolean {
    return existsSync(OpenPetsClient.defaultSocketPath());
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (!existsSync(this.socketPath)) return false;

    return new Promise((resolve) => {
      const sock = createConnection(this.socketPath);
      const timeout = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, 2000);

      sock.on("connect", () => {
        clearTimeout(timeout);
        this.connected = true;
        this.socket = sock;

        let buf = "";
        sock.on("data", (data: Buffer) => {
          buf += data.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const resp = JSON.parse(line) as { id: string; ok: boolean; result?: unknown; error?: { message: string } };
              const cb = this.pending.get(resp.id);
              if (cb) {
                this.pending.delete(resp.id);
                if (resp.ok) cb.resolve(resp.result);
                else cb.reject(new Error(resp.error?.message ?? "Unknown error"));
              }
            } catch { /* ignore parse errors */ }
          }
        });

        sock.on("close", () => {
          this.connected = false;
          this.socket = null;
        });

        sock.on("error", () => {
          this.connected = false;
          this.socket = null;
        });

        resolve(true);
      });

      sock.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async sendEvent(event: OpenPetsEvent): Promise<void> {
    if (!this.connected || !this.socket) return;
    try {
      await this.request("event", { ...event, source: "pi-pets", timestamp: Date.now() });
    } catch { /* ignore */ }
  }

  async setState(state: OpenPetsState, message?: string): Promise<void> {
    await this.sendEvent({ type: "state_change", state, message });
  }

  async selectPet(path: string): Promise<void> {
    try {
      await this.request("pet", { path });
    } catch { /* ignore */ }
  }

  async health(): Promise<unknown> {
    return this.request("health", undefined);
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.pending.clear();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Not connected"));
      const id = String(++this.reqId);
      this.pending.set(id, { resolve, reject });
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 3000);
      const orig = this.pending.get(id)!;
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); orig.resolve(v); },
        reject: (e) => { clearTimeout(timeout); orig.reject(e); },
      });
      this.socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  /** Map a pi-pets emotion to an OpenPets state */
  static mapEmotion(emotion: string): OpenPetsState {
    return EMOTION_MAP[emotion] ?? "idle";
  }
}
