import "dotenv/config";
import { prisma } from "../src/db/prisma.js";

// phrase is stored lowercase to match the service's normalization and the
// unique constraint. Bare words cover their multi-word variants ("mint"
// matches "mint live"), so only high-signal standalone phrases are seeded.
const SEED: Array<[phrase: string, tag: string]> = [
  // Mint
  ["mint", "Mint"],
  ["nft mint", "NFT"],
  ["free mint", "Mint"],
  ["public mint", "Mint"],
  ["mint pass", "Mint"],
  ["reveal", "Reveal"],
  // Whitelist
  ["whitelist", "WL"],
  ["allowlist", "WL"],
  ["wl", "WL"],
  ["gtd", "GTD"],
  ["guaranteed spot", "GTD"],
  ["fcfs", "FCFS"],
  // Sale / TGE
  ["tge", "TGE"],
  ["ido", "IDO"],
  ["presale", "Presale"],
  ["token sale", "Sale"],
  ["public sale", "Sale"],
  ["listing", "Listing"],
  ["launchpool", "Launchpool"],
  // Airdrop
  ["airdrop", "Airdrop"],
  ["snapshot", "Airdrop"],
  ["claim", "Claim"],
  // Infra
  ["staking", "Staking"],
  ["mainnet", "Mainnet"],
  ["testnet", "Testnet"],
  ["bridge", "Bridge"],
  // Alpha / collabs
  ["alpha", "Alpha"],
  ["ca", "CA"],
  ["contract address", "CA"],
  ["node sale", "Node"],
  ["partnership", "Collab"],
  ["collab", "Collab"],
  ["backed by", "Backed"],
];

async function main() {
  // skipDuplicates keeps existing rows (and any tag/enabled edits on them)
  // untouched, so re-running is always safe.
  const created = await prisma.keyword.createMany({
    data: SEED.map(([phrase, tag]) => ({ phrase, tag, enabled: true })),
    skipDuplicates: true,
  });
  console.log(
    `[seed-keywords] created ${created.count}, skipped ${SEED.length - created.count} (already present)`,
  );
}

main()
  .catch((error) => {
    console.error("[seed-keywords] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
