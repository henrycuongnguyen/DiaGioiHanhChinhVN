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

function getLocationTypeValue(displayName) {
    if (displayName.startsWith("Tỉnh")) {
        return 12;
    }
    if (displayName.startsWith("Thành phố") || displayName.startsWith("Thành Phố")) {
        return 21;
    }
    if (displayName.startsWith("Quận")) {
        return 22;
    }
    if (displayName.startsWith("Huyện")) {
        return 23;
    }
    if (displayName.startsWith("Phường")) {
        return 31;
    }
    if (displayName.startsWith("Xã")) {
        return 32;
    }
    if (displayName.startsWith("Thị trấn") || displayName.startsWith("Thị Trấn")) {
        return 33;
    }
    if (displayName.startsWith("Thị xã") || displayName.startsWith("Thị Xã")) {
        return 24;
    }
    return null;
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
            console.log(province.Id)
            var dbprovinces = await client.query(`SELECT * FROM "Locations" WHERE "Id" = $1`, [province.Id]);
            if (dbprovinces.rows.length <= 0) {
                var normalizedName = normalizeName(province.Name);
                var address = province.Name;
                var type = getLocationTypeValue(province.Name);
                imported.push({
                    Id: province.Id,
                    Name: province.Name,
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
                    [province.Id, province.Name, null, address, normalizedName, 6, "VN", true, 3, type]
                );
            } else {
                const dbProvince = dbprovinces.rows[0];
                // If the province already exists, we can update IsActive = true
                const address = province.Name;
                const type = getLocationTypeValue(province.Name);
                const normalizedName = normalizeName(province.Name);
                await client.query(
                    'UPDATE "Locations" SET "Name" = $1, "Address" = $2, "NormalizedName" = $3, "Type" = $4, "IsActive" = $5 WHERE "Id" = $6',
                    [province.Name, address, normalizedName, type, true, dbProvince.Id]
                );
            }
            var dbDistricts = await client.query(`SELECT * FROM "Locations" WHERE "ParentId" = $1`, [province.Id]);
            var districts = province.Districts;
            for (const district of districts) {
                var id = province.Id + "" + district.Id;
                var dbDistrict = dbDistricts.rows.find(x => x.Name == district.Name);
                var dbWards = { rows: [] };
                if (dbDistrict) {
                    id = dbDistrict.Id;
                    await client.query('UPDATE "Locations" SET "IsActive" = $1 WHERE "Id" = $2', [true, id]);
                    dbWards = await client.query(`SELECT * FROM "Locations" WHERE "ParentId" = $1`, [id]);
                } else {
                    id = GeneratorId(dbDistricts.rows, id);
                    var normalizedName = normalizeName(district.Name);
                    var address = district.Name + ", " + province.Name;
                    var type = getLocationTypeValue(district.Name);
                    imported.push({
                        Id: id,
                        Name: district.Name,
                        ParentId: province.Id,
                        Address: address,
                        NormalizedName: normalizedName,
                        Status: 6,
                        Country: "VN",
                        IsActive: true,
                        Level: 4,
                        Type: type
                    });
                    await client.query(
                        'INSERT INTO "Locations" ("Id", "Name", "ParentId","Address","NormalizedName","Status","Country","IsActive","Level","Type") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                        [id, district.Name, province.Id, address, normalizedName, 6, "VN", true, 4, type]
                    );
                }

                var wards = district.Wards;
                if (!wards.some(x => x.Name)) continue;
                for (const ward of wards) {
                    var wardId = id + "" + ward.Id;
                    var dbWard = dbWards.rows.find(x => x.Name == ward.Name);
                    var normalizedName = normalizeName(ward.Name);
                    var address = ward.Name + ", " + district.Name + ", " + province.Name;
                    console.log(ward)
                    var type = getLocationTypeValue(ward.Name);
                    if (dbWard) {
                        wardId = dbWard.Id;
                        await client.query('UPDATE "Locations" SET "IsActive" = $1 WHERE "Id" = $2', [true, wardId]);
                    } else {
                        wardId = GeneratorId(dbWards.rows, wardId);
                        imported.push({
                            Id: wardId,
                            Name: ward.Name,
                            ParentId: id,
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
                            [wardId, ward.Name, id, address, normalizedName, 6, "VN", true, 5, type]
                        );
                    }
                }

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

function GeneratorId(data, id) {
    if (data.some(x => x.Id == id)) {
        id += "_X"
        return GeneratorId(data, id);
    }
    return id;
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