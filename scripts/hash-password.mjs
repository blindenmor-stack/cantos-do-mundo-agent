#!/usr/bin/env node
// Usage: node scripts/hash-password.mjs <password>
// Prints a hash compatible with lib/users.ts (PBKDF2 saltHex:hashHex).

import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
console.log(salt.toString("hex") + ":" + hash.toString("hex"));
