/**
 * File I/O abstraction.
 *
 * FileIO interface is used everywhere instead of direct node:fs calls.
 * NodeFileIO is the real implementation; tests use InMemoryFileIO.
 */

import * as fs from "node:fs/promises";
import type { FileIO } from "./types";

export type { FileIO } from "./types";

export class NodeFileIO implements FileIO {
  async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf-8");
  }

  async readdir(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async mkdir(filePath: string): Promise<void> {
    await fs.mkdir(filePath, { recursive: true });
  }

  async access(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async unlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // File may already be gone — ignore
    }
  }
}
