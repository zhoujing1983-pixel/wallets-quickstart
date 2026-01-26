/* eslint-disable no-console */
const Database = require("better-sqlite3");
const { load } = require("sqlite-vec");

const db = new Database(":memory:");
load(db);

db.exec("CREATE VIRTUAL TABLE v USING vec0(embedding float[2])");

const insert = db.prepare("INSERT INTO v (embedding) VALUES (?)");
insert.run(JSON.stringify([1, 0])); // rowid 1
insert.run(JSON.stringify([0, 1])); // rowid 2
insert.run(JSON.stringify([2, 0])); // rowid 3
insert.run(JSON.stringify([-1, 0])); // rowid 4

const query = [1, 0];
const rows = db
  .prepare(
    "SELECT rowid, distance FROM v WHERE embedding MATCH ? AND k = ? ORDER BY distance",
  )
  .all(JSON.stringify(query), 4);

console.log("Query:", query);
console.log("Distances:", rows);
