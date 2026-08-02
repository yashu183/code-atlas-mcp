import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One index db per repo, stored inside the repo but gitignored.
export const DB_PATH = path.join(process.cwd(), ".repo-index", "index.db");

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const schema = fs.readFileSync(
    path.join(__dirname, "..", "schema.sql"),
    "utf-8"
  );
  db.exec(schema);
  return db;
}
