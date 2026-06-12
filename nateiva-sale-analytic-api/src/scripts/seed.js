const { hashPassword } = require("../auth");
const { findUserByUsername, createUser } = require("../repository");
const { closePool } = require("../db");

const DEFAULT_USERS = [
  { username: "ivan", password: "ivan123", fullName: "Ivan", role: "Expert", city: "YAOUNDE" },
  { username: "fabiola", password: "fabiola123", fullName: "Kendo Fabiola", role: "Expert", city: "DOUALA" },
  { username: "ida", password: "ida123", fullName: "Emambo Ida", role: "Expert", city: "DOUALA" },
  { username: "guy", password: "guy123", fullName: "Ntsa Guy", role: "SubAdmin", city: "YAOUNDE" },
  { username: "brice", password: "brice123", fullName: "Mbeuka brice", role: "SubAdmin", city: "DOUALA" },
  { username: "taylor", password: "taylor123", fullName: "Kessi Taylor", role: "Expert", city: "YAOUNDE" },
  { username: "noah", password: "noah2026", fullName: "Noah", role: "SuperAdmin", city: "ALL" }
];

async function main() {
  for (const user of DEFAULT_USERS) {
    const existing = await findUserByUsername(user.username, false);
    if (existing) {
      console.log(`skip ${user.username}`);
      continue;
    }
    await createUser({
      username: user.username,
      passwordHash: await hashPassword(user.password),
      fullName: user.fullName,
      role: user.role,
      city: user.city
    });
    console.log(`seeded ${user.username}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
