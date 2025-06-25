const { Pool } = require('pg');
const fs = require('fs');

// Database configuration
const pool = new Pool({
    user: 'nobiv2-bug-kiot-staticupdate.ecrm.vn',
    password: 'd2db6d4fbe3f4736a101a3f9fed0ef1e',
    host: '61.28.231.241',
    port: 5432,
    database: 'nobiv2-bug-kiot-staticupdate.ecrm.vn'
});

function getLocationTypeValue(displayName, placeType) {
    // For provinces, use place_type
    if (placeType) {
        if (placeType === "Thành phố Trung Ương") return 21;
        if (placeType === "Tỉnh") return 12;
        // Default type for province if place_type doesn't match
        return 12;
    }
    
    // For wards, use name prefix - normalize the name first to handle case variations
    const normalizedName = displayName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    
    // Handle all ward types
    if (normalizedName.startsWith("phuong")) return 31;
    if (normalizedName.startsWith("xa")) return 32;
    if (normalizedName.startsWith("thi tran") || normalizedName.startsWith("thị trấn")) return 33;
    
    // Handle district types
    if (normalizedName.startsWith("quan")) return 22;
    if (normalizedName.startsWith("huyen")) return 23;
    if (normalizedName.startsWith("thi xa") || normalizedName.startsWith("thị xã")) return 24;
    
    // If it's a ward (based on context) but doesn't match any prefix, determine by common patterns
    if (normalizedName.includes("phuong") || normalizedName.includes("phường")) return 31;
    if (normalizedName.includes("xa") || normalizedName.includes("xã")) return 32;
    if (normalizedName.includes("thi tran") || normalizedName.includes("thị trấn")) return 33;
    
    // Default type based on context - since this is called for wards, default to ward type
    return 32; // Default to Xã type if no other match (most common case in rural areas)
}

function GeneratorId(data, id) {
    if (data.some(x => x.Id == id)) {
        id += "_X";
        return GeneratorId(data, id);
    }
    return id;
}

async function importData() {
    try {
        // Read JSON file
        const provinces = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        const imported = [];

        // Connect to database
        const client = await pool.connect();

        console.log('Starting import...');

        // Insert data into Locations table
        for (const province of provinces) {
            console.log(province.province_code)
            var dbprovinces = await client.query(`SELECT * FROM "Locations" WHERE "Id" = $1`, [province.province_code]);
            var provinceId = province.province_code;
            var normalizedName = normalizeName(province.name);
            var address = province.name;
            var type = getLocationTypeValue(province.name, province.place_type);
            
            // Check for duplicate province ID - only check ID existence
            if (dbprovinces.rows.length > 0) {
                // If province exists with same ID but different name, generate new ID
                if (dbprovinces.rows[0].Name !== province.name) {
                    provinceId = GeneratorId(dbprovinces.rows, provinceId);
                    // Insert as new province with new ID
                    imported.push({
                        Id: provinceId,
                        Name: province.name,
                        ParentId: null,
                        Address: address,
                        NormalizedName: normalizedName,
                        Status: 6,
                        Country: "VN",
                        IsActive: true,
                        Level: 3,
                        Type: type
                    });
                    await client.query(
                        'INSERT INTO "Locations" ("Id", "Name", "ParentId","Address","NormalizedName","Status","Country", "IsActive","Level","Type") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                        [provinceId, province.name, null, address, normalizedName, 6, "VN", true, 3, type]
                    );
                } else {
                    // If same province (same name), just update IsActive
                    await client.query(
                        'UPDATE "Locations" SET "IsActive" = $1 WHERE "Id" = $2',
                        [true, provinceId]
                    );
                }
            } else {
                // If province doesn't exist, insert new
                imported.push({
                    Id: provinceId,
                    Name: province.name,
                    ParentId: null,
                    Address: address,
                    NormalizedName: normalizedName,
                    Status: 6,
                    Country: "VN",
                    IsActive: true,
                    Level: 3,
                    Type: type
                });
                await client.query(
                    'INSERT INTO "Locations" ("Id", "Name", "ParentId","Address","NormalizedName","Status","Country", "IsActive","Level","Type") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                    [provinceId, province.name, null, address, normalizedName, 6, "VN", true, 3, type]
                );
            }

            var wards = province.wards;
            if (!wards || !wards.length) continue;

            for (const ward of wards) {
                console.log(ward)
                var wardId = ward.ward_code;
                var normalizedName = normalizeName(ward.name);
                var address = ward.name + ", " + province.name;
                var type = getLocationTypeValue(ward.name);
                
                // Check for duplicate ward ID in entire Locations table
                var existingLocation = await client.query(`SELECT * FROM "Locations" WHERE "Id" = $1`, [wardId]);
                
                if (existingLocation.rows.length > 0) {
                    // Update existing record only if it's the same ward (same parent province and same name)
                    if (existingLocation.rows[0].ParentId === provinceId && existingLocation.rows[0].Name === ward.name) {
                        await client.query('UPDATE "Locations" SET "IsActive" = $1 WHERE "Id" = $2', [true, wardId]);
                        continue;
                    }
                    // If it's a different ward (different parent province or different name), generate new ID
                    var allLocations = await client.query(`SELECT * FROM "Locations"`);
                    wardId = GeneratorId(allLocations.rows, wardId);
                }
                
                // At this point, wardId is either original (if no duplicate) or new (if there was a duplicate)
                imported.push({
                    Id: wardId,
                    Name: ward.name,
                    ParentId: provinceId,
                    Address: address,
                    NormalizedName: normalizedName,
                    Status: 6,
                    Country: "VN",
                    IsActive: true,
                    Level: 5,
                    Type: type
                });
                await client.query(
                    'INSERT INTO "Locations" ("Id", "Name", "ParentId","Address","NormalizedName","Status","Country","IsActive","Level","Type") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                    [wardId, ward.name, provinceId, address, normalizedName, 6, "VN", true, 5, type]
                );
            }
        }

        console.log('Import completed successfully');
        client.release();
        fs.writeFileSync('imported.json', JSON.stringify(imported));
        await pool.end();

    } catch (error) {
        console.error('Error during import:', error);
        process.exit(1);
    }
}

function normalizeName(name) {
    if (!name) return '';
    // Remove diacritics and convert to uppercase
    var normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toUpperCase();
    // remove all THI XA, THI TRAN, TINH, HUYEN ,XA
    normalizedName = normalizedName.replace(/THI XA|THI TRAN|TINH|HUYEN|XA|THANH PHO|QUAN|PHUONG/g, "").trim();
    return normalizedName;
}

importData();