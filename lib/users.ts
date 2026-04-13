export interface DashboardUser {
  email: string;
  hash: string; // PBKDF2 saltHex:hashHex (see lib/crypto-utils.ts)
  name?: string;
}

// NOTE: add/remove users by editing this list and redeploying.
// To generate a new hash, run:
//   npx tsx scripts/hash-password.ts <password>
// or use the helper in lib/crypto-utils.ts: hashPassword(pw)
export const DASHBOARD_USERS: DashboardUser[] = [
  {
    email: "blinden.mor@gmail.com",
    hash: "3ff1c4c8dc93b5f617c9e9d91c05adb8:229b95b8d15ccaa988e37a7ce9e3af4a805f0e3a90b75d25c3d507561e5d0d34",
    name: "Bernardo",
  },
  {
    email: "contato@turcantosdomundo.com.br",
    hash: "fd4fc79cfe172434bd8ab2517e8461c7:4a233a96b2a483f74a79ed046404c63a0e87994c5dd1df9f4a6d822804c50857",
    name: "Cantos do Mundo",
  },
];

export function findUserByEmail(email: string): DashboardUser | null {
  const target = (email || "").trim().toLowerCase();
  return (
    DASHBOARD_USERS.find((u) => u.email.toLowerCase() === target) || null
  );
}
