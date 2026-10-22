/**
 * Password hashing with scrypt (node:crypto), no native dependencies.
 * Stored as `scrypt$N$r$p$<salt base64>$<hash base64>` so the cost can be
 * raised later without breaking old hashes.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
};
