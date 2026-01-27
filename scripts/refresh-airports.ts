import fs from "fs/promises";
import path from "path";
import { buildAirportIndexFromCsv } from "@/agent/airports/airports-index";

const AIRPORTS_CSV_URL = "https://ourairports.com/data/airports.csv";

const run = async () => {
  const targetDir = path.join(process.cwd(), "rag-docs/ourairports");
  await fs.mkdir(targetDir, { recursive: true });
  const csvPath = path.join(targetDir, "airports.csv");
  const indexPath = path.join(targetDir, "airports-index.json");

  const response = await fetch(AIRPORTS_CSV_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download airports.csv: ${response.status} ${response.statusText}`,
    );
  }
  const csv = await response.text();
  await fs.writeFile(csvPath, csv, "utf8");

  const index = buildAirportIndexFromCsv(csv);
  await fs.writeFile(indexPath, JSON.stringify(index), "utf8");

  console.log("Saved airports.csv:", csvPath);
  console.log("Saved airports-index.json:", indexPath);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
