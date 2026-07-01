// Fixture tests for owner qualifying. Run: node test/owner.test.mjs
import { parseVestDate, tenureYears, classifyOccupancy, valueBandPts, leadScore, equityTier, toOwnerRecord } from "../src/lib/owner.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); } };
const NOW = new Date("2026-07-01T00:00:00Z");

// --- date parsing ---
ok("parse real vesting date", parseVestDate("Oct 13 1982 12:00AM")?.getFullYear() === 1982);
ok("parse double-spaced date", parseVestDate("Aug  4 2020 12:00AM")?.getFullYear() === 2020);
ok("reject 1900 placeholder", parseVestDate("Jan  1 1900 12:00AM") === null);
ok("reject empty/null", parseVestDate("") === null && parseVestDate(null) === null);

// --- tenure ---
ok("tenure ~43 yrs from 1982", tenureYears(parseVestDate("Oct 13 1982 12:00AM"), NOW) === 43, String(tenureYears(parseVestDate("Oct 13 1982 12:00AM"), NOW)));
ok("tenure null when unknown", tenureYears(null, NOW) === null);

// --- occupancy (real Kearns shapes) ---
ok("owner-occupant: mailing == property",
  classifyOccupancy({ own_name: "RUDY J GONZALES (TC)", own_addr: "5045 W 4985 S", prop_location: "5045 W 4985 S", taxable_value: 206800, total_full_mkt: 376000 }).tag === "owner-occupant");
ok("investor: entity mails elsewhere",
  classifyOccupancy({ own_name: "AVES PROPERTIES, LC", own_addr: "1065 W LEVOY DR", prop_location: "2991 S PLATEAU DR", taxable_value: 164300, total_full_mkt: 164300 }).tag === "investor");
ok("investor: entity registered AT the property (entity beats address match)",
  classifyOccupancy({ own_name: "AVES PROPERTIES, LC", own_addr: "2991 S PLATEAU DR", prop_location: "2991 S PLATEAU DR", taxable_value: 164300, total_full_mkt: 164300 }).tag === "investor");
ok("investor: person mails elsewhere, no exemption",
  classifyOccupancy({ own_name: "MD TR", own_addr: "50 S 200 E", prop_location: "3005 S PLATEAU DR", taxable_value: 164300, total_full_mkt: 164300 }).tag === "investor");
ok("owner-occupant rescue via exemption on addr mismatch",
  classifyOccupancy({ own_name: "JANE DOE", own_addr: "PO BOX 123", prop_location: "5045 W 4985 S", taxable_value: 206800, total_full_mkt: 376000 }).tag === "owner-occupant");
ok("unknown when nothing usable",
  classifyOccupancy({ own_name: "JANE DOE", own_addr: "", prop_location: "", taxable_value: null, total_full_mkt: null }).tag === "unknown");

// --- value band ---
ok("value band peaks mid-market", valueBandPts(400000) === 22 && valueBandPts(1200000) === 9 && valueBandPts(150000) === 11);

// --- lead score ---
{
  const longHeld = leadScore({ date_created: "Oct 13 1982 12:00AM", total_full_mkt: 376000, year_built: 1975 }, NOW);
  const recent = leadScore({ date_created: "Jun 1 2025 12:00AM", total_full_mkt: 376000, year_built: 1979 }, NOW);
  ok("long-held owner scores higher than recent buyer", longHeld > recent, `${longHeld} vs ${recent}`);
  ok("long-held is hot tier", equityTier(longHeld) === "hot", `${longHeld} ${equityTier(longHeld)}`);
  ok("brand-new buyer is cool tier", equityTier(recent) === "cool", `${recent} ${equityTier(recent)}`);
  const unknownDate = leadScore({ date_created: "Jan  1 1900 12:00AM", total_full_mkt: 376000, year_built: 1979 }, NOW);
  ok("unknown tenure lands warm, not hot", equityTier(unknownDate) === "warm", `${unknownDate} ${equityTier(unknownDate)}`);
}

// --- record assembly ---
{
  const r = toOwnerRecord({ parcel_id: "20122550080000", own_name: "RUDY J GONZALES (TC)", own_addr: "5045 W 4985 S", prop_location: "5045 W 4985 S", date_created: "Oct 13 1982 12:00AM", taxable_value: 206800, total_full_mkt: 376000, year_built: 1975, total_sq_ft: 922 }, NOW, 1751328000000);
  ok("record: owner-occupant + tenure + hot", r.occupancy === "owner-occupant" && r.tenureYrs === 43 && r.tier === "hot", JSON.stringify(r));
  ok("record: carries fetchedAt", r.fetchedAt === 1751328000000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
