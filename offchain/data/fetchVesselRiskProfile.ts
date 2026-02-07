import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load env vars
dotenv.config();

const API_KEY = process.env.DATALASTIC_API_KEY;
const DATA_API = "https://api.datalastic.com/api";

// Helper to delay between API calls to avoid rate limits
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchData(url: string) {
    try {
        console.log(`fetching ${url}...`);
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Error: ${res.status} ${res.statusText}`);
            return null;
        }
        return await res.json();
    } catch (e: any) {
        console.error(`Fetch failed: ${e.message}`);
        return null; // Return null on failure so we can handle it gracefully (e.g. empty mock data)
    }
}

async function processVessel(vessel: any) {
    const IMO = vessel.imo;
    const NAME = vessel.name;
    console.log(`\n🚢 Processing ${NAME} (IMO: ${IMO})...`);

    // 1. PSC Inspections
    // Logic from server.ts: /api/proxy/risk/psc/:imo
    const pscUrl = `${DATA_API}/maritime_reports/inspections?api-key=${API_KEY}&imo=${IMO}`;
    const pscRaw = await fetchData(pscUrl);

    const pscProcessed = {
        imo: IMO,
        risk_detected: false,
        detention_count: 0,
        deficiency_count: 0,
        deficiency_description: "",
        inspection_authority: "",
        inspection_port: "",
        inspection_date: "",
        detention: "False"
    };

    if (pscRaw && pscRaw.data) {
        const inspections = pscRaw.data;
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const recentDetentions = inspections.filter((i: any) => {
            const isDetained = i.detention === true || i.detention === "TRUE" || (parseInt(i.detention) > 0);
            return isDetained && new Date(i.date || i.inspection_date) > oneYearAgo;
        });

        const latest = inspections[0] || {};

        pscProcessed.risk_detected = recentDetentions.length > 0;
        pscProcessed.detention_count = recentDetentions.length;
        pscProcessed.deficiency_count = parseInt(latest.ship_deficiencies || "0");
        pscProcessed.deficiency_description = latest.deficiency_description || "";
        pscProcessed.inspection_authority = latest.inspection_authority || latest.authority || "Unknown";
        pscProcessed.inspection_port = latest.inspection_port || latest.port || "";
        pscProcessed.inspection_date = latest.inspection_date || latest.date || "";
        pscProcessed.detention = latest.detention || "False";
    }
    await sleep(200); // polite delay

    // 2. Dry Dock
    // Logic from server.ts: /api/proxy/risk/drydock/:imo
    const ddUrl = `${DATA_API}/maritime_reports/dry_dock_dates?api-key=${API_KEY}&imo=${IMO}`;
    const ddRaw = await fetchData(ddUrl);

    const ddProcessed = {
        imo: IMO,
        next_due_date: null as string | null,
        dry_dock_from: null as string | null,
        dry_dock_to: null as string | null,
        is_overdue: false
    };

    if (ddRaw && ddRaw.data) {
        const data = Array.isArray(ddRaw.data) ? ddRaw.data[0] : ddRaw.data;
        if (data) {
            if (data.dry_dock_next_due) {
                ddProcessed.next_due_date = data.dry_dock_next_due;
                ddProcessed.is_overdue = new Date(data.dry_dock_next_due) < new Date();
            }
            ddProcessed.dry_dock_from = data.dry_dock_from || null;
            ddProcessed.dry_dock_to = data.dry_dock_to || null;
        }
    }
    await sleep(200);

    // 3. Casualty
    // Logic from server.ts: /api/proxy/risk/casualty/:imo
    const casUrl = `${DATA_API}/maritime_reports/casualty?api-key=${API_KEY}&imo=${IMO}`;
    const casRaw = await fetchData(casUrl);

    const casProcessed = {
        imo: IMO,
        casualty_detected: false,
        casualty_type: "",
        casualty_date: null as string | null,
        casualty_details: "",
        vessel_name: ""
    };

    if (casRaw && casRaw.data) {
        const casualties = casRaw.data;
        if (casualties.length > 0) {
            const latest = casualties[0];
            casProcessed.casualty_detected = true;
            casProcessed.casualty_type = latest.casualty_type;
            casProcessed.casualty_date = latest.casualty_date || latest.date;
            casProcessed.casualty_details = latest.casualty_details || "";
            casProcessed.vessel_name = latest.vessel_name || "";
        }
    }
    await sleep(200);

    // 4. Voyage / Vessel Info
    // Logic from server.ts: /api/proxy/risk/voyage/:imo
    const voyUrl = `${DATA_API}/v0/vessel?api-key=${API_KEY}&imo=${IMO}`;
    const voyRaw = await fetchData(voyUrl);

    const voyProcessed = {
        imo: IMO,
        voyage_completed: false,
        current_lat: 0,
        current_lon: 0,
        destination: "",
        eta: "",
        navigation_status: "Unknown"
    };

    if (voyRaw && voyRaw.data) {
        const v = Array.isArray(voyRaw.data) ? voyRaw.data[0] : voyRaw.data;
        if (v) {
            voyProcessed.current_lat = parseFloat(v.lat);
            voyProcessed.current_lon = parseFloat(v.lon);
            voyProcessed.destination = v.destination;
            voyProcessed.eta = v.eta;
            voyProcessed.navigation_status = v.nav_status || "Unknown";
        }
    }
    await sleep(200);

    // 5. Congestion
    // Logic from server.ts: /api/proxy/risk/congestion (uses lat/lon)
    // Use vessel's current position
    const lat = voyProcessed.current_lat !== 0 ? voyProcessed.current_lat : vessel.lat;
    const lon = voyProcessed.current_lon !== 0 ? voyProcessed.current_lon : vessel.lon;

    let congProcessed = {
        vessel_count: 0,
        anchored_count: 0
    };
    let congRaw = null;

    if (lat && lon) {
        const radius = 10;
        const congUrl = `${DATA_API}/v0/vessel_inradius?api-key=${API_KEY}&lat=${lat}&lon=${lon}&radius=${radius}`;
        congRaw = await fetchData(congUrl);

        if (congRaw && congRaw.data) {
            const vessels = congRaw.data;
            if (Array.isArray(vessels)) {
                congProcessed.vessel_count = vessels.length;
                congProcessed.anchored_count = vessels.filter((v: any) =>
                    v.nav_status === "At Anchor" || v.nav_status_code === 1 || v.nav_status === "1"
                ).length;
            } else {
                console.warn(`[Warn] Congestion data for ${IMO} is not an array (likely error or limit reached)`);
            }
        }
    }
    await sleep(200);

    // Aggregate
    const fullProfile = {
        meta: {
            timestamp: new Date().toISOString(),
            imo: IMO,
            name: NAME,
            source: "Datalastic API via eth-oxford fetcher"
        },
        psc: pscProcessed,
        drydock: ddProcessed,
        casualty: casProcessed,
        voyage: voyProcessed,
        congestion: congProcessed,

        // Include RAW data for debugging if needed (EXCLUDE congestion for FDC size limits)
        raw: {
            psc: pscRaw,
            drydock: ddRaw,
            casualty: casRaw,
            voyage: voyRaw,
            // congestion: congRaw // Too large for FDC Verifier
        }
    };

    // Save
    const outDir = path.join(process.cwd(), 'offchain/data/psc');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `${IMO}.json`);
    fs.writeFileSync(outFile, JSON.stringify(fullProfile, null, 2));

    console.log(`✅ Saved: ${outFile}`);
}

async function main() {
    if (!API_KEY) {
        console.error("❌ Misisng DATALASTIC_API_KEY in .env");
        process.exit(1);
    }

    const vesselsFile = path.join(process.cwd(), 'offchain/data/discovered_vessels.json');
    if (!fs.existsSync(vesselsFile)) {
        console.error("❌ discovered_vessels.json not found");
        process.exit(1);
    }

    const vessels = JSON.parse(fs.readFileSync(vesselsFile, 'utf-8'));
    console.log(`📋 Found ${vessels.length} vessels to process...`);

    for (const vessel of vessels) {
        await processVessel(vessel);
    }

    console.log("\n🎉 All vessels processed!");
}

main();
