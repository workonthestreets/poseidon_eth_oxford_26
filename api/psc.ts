import type { VercelRequest, VercelResponse } from '@vercel/node';

const DATA_API = "https://api.datalastic.com/api";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { imo } = req.query;
    const apiKey = process.env.DATALASTIC_API_KEY;

    // Set CORS headers for public access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    if (!imo) {
        return res.status(400).json({ error: 'IMO parameter required' });
    }

    try {
        const url = `${DATA_API}/maritime_reports/inspections?api-key=${apiKey}&imo=${imo}`;
        console.log(`[PSC] Fetching for IMO: ${imo}`);

        // Default safe state
        let responseData: Record<string, any> = {
            imo: String(imo),
            risk_detected: false,
            detention_count: 0,
            deficiency_count: 0,
            deficiency_description: "",
            inspection_authority: "",
            inspection_port: "",
            inspection_date: "",
            detention: "0"
        };

        if (apiKey) {
            const response = await fetch(url);
            if (response.ok) {
                const json: any = await response.json();
                const inspections = json.data || [];

                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

                const recentDetentions = inspections.filter((i: any) => {
                    const isDetained = i.detention === true || i.detention === "TRUE" || parseInt(i.detention) > 0;
                    return isDetained && new Date(i.date || i.inspection_date) > oneYearAgo;
                });

                const latest = inspections[0];

                responseData.risk_detected = recentDetentions.length > 0;
                responseData.detention_count = recentDetentions.length;
                responseData.deficiency_count = latest ? parseInt(latest.ship_deficiencies || "0") : 0;
                responseData.deficiency_description = latest ? (latest.deficiency_description || "") : "";
                responseData.inspection_authority = latest ? (latest.inspection_authority || latest.mou || "") : "";
                responseData.inspection_port = latest ? (latest.inspection_port || latest.port || "") : "";
                responseData.inspection_date = latest ? (latest.inspection_date || latest.date || "") : "";
                responseData.detention = latest ? String(latest.detention || "0") : "0";
            }
        }

        return res.status(200).json(responseData);
    } catch (e: any) {
        console.error('[PSC] Error:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
