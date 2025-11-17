import { Buffer } from "buffer";
import process from "process";

type GlobalShim = typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: typeof process;
  global?: typeof globalThis;
};

const globalShim = globalThis as GlobalShim;

if (!globalShim.global) {
  globalShim.global = globalShim;
}

if (!globalShim.process) {
  globalShim.process = process;
} else {
  globalShim.process = Object.assign(globalShim.process, process);
}

const processShim = globalShim.process as unknown as Record<string, unknown>;

if (!("env" in processShim) || typeof processShim.env !== "object" || processShim.env === null) {
  processShim.env = {};
}

if (typeof processShim.version !== "string") {
  processShim.version = "0.0.0";
}

if (typeof processShim.versions !== "object" || processShim.versions === null) {
  processShim.versions = {};
}

processShim.browser = true;

if (!globalShim.Buffer) {
  globalShim.Buffer = Buffer;
}

if (!(window as GlobalShim).Buffer) {
  (window as GlobalShim).Buffer = Buffer;
}


