import sql from "mssql";
import {dbConfig} from "./db-config.js";

export const tenancyCheck = async (tenantId, greenhouseId) => {
    try {
        const pool = await sql.connect(dbConfig);
        const request = pool.request()
            .input('TenantId', sql.Int, tenantId);

        let query = `
            SELECT 1 FROM greenhouses
            WHERE tenant_id = @TenantId
        `;

        if (greenhouseId !== undefined && greenhouseId !== null) {
            request.input('GreenhouseId', sql.Int, greenhouseId);
            query += ' AND id = @GreenhouseId';
        }

        const result = await request.query(query);
        return result.recordset.length > 0;
    } catch (err) {
        console.error('SQL error while checking greenhouse ownership:', err.message);
        return false;
    }
};


export const isAdmin = async (userId) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .query(`
                SELECT role
                FROM users
                WHERE ID = @UserId
            `);

        const user = result.recordset[0];

        if (!user) {
            return { success: false, isAdmin: false, error: 'User not found' };
        }

        console.log('User found:', user);

        const isAdmin = user.role?.toLowerCase() === 'admin';
        return { success: true, isAdmin, user: user };
    } catch (err) {
        console.error('SQL error while checking admin role:', err.message);
        return { success: false, isAdmin: false, error: err.message };
    }
};


export const fetchLatestSensorData = async (greenhouseId) => {
    console.log(`Fetching latest sensor data from DB for Greenhouse ID: ${greenhouseId}`);
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('GreenhouseId', sql.Int, greenhouseId)
            .query(`
                SELECT TOP 1 temperature, humidity, recorded_at
                FROM sensor_data
                WHERE greenhouse_id = @GreenhouseId
                ORDER BY recorded_at DESC
            `);
        console.log('Sensor data fetched:', result.recordset[0]);
        return { success: true, data: result.recordset[0] };
    } catch (err) {
        console.error('SQL error while fetching sensor data:', err.message);
        return { success: false, error: err.message };
    }
};

export const fetchLatestWindowStatus = async (greenhouseId) => {
    console.log(`Fetching latest window status from DB for Greenhouse ID: ${greenhouseId}`);
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('GreenhouseId', sql.Int, greenhouseId)
            .query(`
                SELECT TOP 1 status, changed_by, recorded_at
                FROM window_status
                WHERE greenhouse_id = @GreenhouseId
                ORDER BY recorded_at DESC
            `);
        console.log('Window status fetched:', result.recordset[0]);
        return { success: true, data: result.recordset[0] };
    } catch (err) {
        console.error('SQL error while fetching window status:', err.message);
        return { success: false, error: err.message };
    }
};

export const fetchLatestIrrigationStatus = async (greenhouseId) => {
    console.log(`Fetching latest irrigation status from DB for Greenhouse ID: ${greenhouseId}`);
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('GreenhouseId', sql.Int, greenhouseId)
            .query(`
                SELECT TOP 1 status, changed_by, recorded_at
                FROM irrigation_status
                WHERE greenhouse_id = @GreenhouseId
                ORDER BY recorded_at DESC
            `);
        console.log('Irrigation status fetched:', result.recordset[0]);
        return { success: true, data: result.recordset[0] };
    } catch (err) {
        console.error('SQL error while fetching irrigation status:', err.message);
        return { success: false, error: err.message };
    }
};