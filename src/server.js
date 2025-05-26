import sql from "mssql";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import express from 'express';
import cors from 'cors';
import dotenv from "dotenv";

import {fetchLatestIrrigationStatus, fetchLatestSensorData, fetchLatestWindowStatus, tenancyCheck} from "./helpers.js";
import {connectionPool} from "./db-config.js";
import {authMiddleware, JWT_SECRET} from "./authentication.js";

dotenv.config();

const SERVER_PORT = process.env.SERVER_PORT || 8080;
const ARDUINO_SECRET_KEY = process.env.ARDUINO_SECRET_KEY;

export const createServer = () => {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(authMiddleware);

    app.listen(SERVER_PORT, () => console.log(`Greenhouse Manager API running on port ${SERVER_PORT}`));

    app.get('/', (req, res) => {
        console.log('API root [GET /] called.');
        res.json({message: 'greenhouse-manager'});
    });

    app.post('/login', async (req, res) => {
        console.log('\n=== NEW LOGIN ATTEMPT ===');
        console.log('Request Body:', req.body);

        if (!req.body || !req.body.username || !req.body.password) {
            console.log('Missing credentials');
            return res.status(400).json({error: 'Username and password required'});
        }

        const {username, password} = req.body;

        try {
            const userQuery = 'SELECT * FROM users WHERE username = @Username';

            const userResult = await connectionPool.request()
                .input('Username', sql.VarChar(50), username)
                .query(userQuery);

            console.log('Query results:', userResult.recordset);

            if (userResult.recordset.length === 0) {
                console.log('User not found');
                return res.status(404).send({
                    success: false,
                    message: 'User not found',
                });
            }

            const user = userResult.recordset[0];
            console.log('Found user:', user.username);

            console.log('Comparing password with hash:', user.password_hash);
            const valid = await bcrypt.compare(password, user.password_hash);
            console.log('Password match result:', valid);

            if (!valid) {
                console.log('Invalid username or password.');
                return res.status(401).send({
                    success: false,
                    message: 'Invalid username or password.',
                });
            }

            const greenhouseQuery = `
            SELECT id, tenant_id, name, location
            FROM greenhouses
            WHERE tenant_id = @TenantId
        `;

            const greenhouseResult = await connectionPool.request()
                .input('TenantId', sql.Int, user.tenant_id)
                .query(greenhouseQuery);

            const greenhouses = greenhouseResult.recordset;
            console.log('Accessible greenhouses:', greenhouses);

            let token;

            try {
                token = jwt.sign(
                    { id: user.id, tenant_id: user.tenant_id, role: user.role },
                    JWT_SECRET,
                    { expiresIn: '1h' }
                );
            } catch (err) {
                console.error('JWT signing error:', err);
                return res.status(500).json({ error: 'Failed to generate authentication token.' });
            }

            console.log('Login successful');

            res.json({
                status: 'success',
                token: token,
                user: {
                    id: user.id,
                    username: user.username,
                    tenant_id: user.tenant_id,
                    role: user.role,
                },
                greenhouses: greenhouses
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error?.message,
            });
        }
    });

    app.post('/register', async (req, res) => {
        console.log('\n=== NEW REGISTER ATTEMPT ===');
        console.log('Request Body:', req.body);

        const { username, password, tenant_id } = req.body;

        if (!username || !password) {
            console.log('Missing required fields');
            return res.status(400).json({ success: false, error: 'Username and password are required.' });
        }

        try {
            const existingUser = await connectionPool.request()
                .input('Username', sql.VarChar(50), username)
                .query('SELECT id FROM users WHERE username = @Username');

            if (existingUser.recordset.length > 0) {
                console.log('Username already exists');
                return res.status(409).json({ error: 'Username already exists' });
            }

            let resolvedTenantId = tenant_id;

            if (tenant_id) {
                const tenantCheck = await connectionPool.request()
                    .input('TenantId', sql.Int, tenant_id)
                    .query('SELECT id FROM tenants WHERE id = @TenantId');

                if (tenantCheck.recordset.length === 0) {
                    const newTenant = await connectionPool.request()
                        .input('Name', sql.VarChar(100), `Auto-created tenant for ${username}`)
                        .query(`
                        INSERT INTO tenants (name)
                        OUTPUT INSERTED.id
                        VALUES (@Name)
                    `);

                    resolvedTenantId = newTenant.recordset[0].id;
                    console.log(`Provided tenant_id (${tenant_id}) was invalid; new tenant created with ID ${resolvedTenantId}`);
                } else {
                    console.log(`Using existing tenant ID: ${tenant_id}`);
                }
            } else {
                const newTenant = await connectionPool.request()
                    .input('Name', sql.VarChar(100), `Default Tenant for ${username}`)
                    .query(`
                    INSERT INTO tenants (name)
                    OUTPUT INSERTED.id
                    VALUES (@Name)
                `);

                resolvedTenantId = newTenant.recordset[0].id;
                console.log(`No tenant ID provided; new tenant created with ID ${resolvedTenantId}`);
            }

            const passwordHash = await bcrypt.hash(password, 10);

            const newUser = await connectionPool.request()
                .input('TenantId', sql.Int, resolvedTenantId)
                .input('Username', sql.VarChar(50), username)
                .input('PasswordHash', sql.VarChar(255), passwordHash)
                .query(`
                INSERT INTO users (tenant_id, username, password_hash, role, created_at)
                OUTPUT INSERTED.id
                VALUES (@TenantId, @Username, @PasswordHash, 'user', GETDATE())
            `);

            const userId = newUser.recordset[0].id;

            return res.status(201).json({
                status: 'success',
                message: 'User registered successfully',
                user: {
                    id: userId,
                    username,
                    tenant_id: resolvedTenantId,
                }
            });

        } catch (error) {
            console.error('Register error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/tenant/:tenantId/greenhouse/:greenhouseId/temperature', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /tenant/${tenantId}/greenhouse/${greenhouseId}/temperature] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {success, data, error} = await fetchLatestSensorData(greenhouseId);
        if (success) {
            res.json({status: 'success', temperature: data?.temperature, timestamp: data?.recorded_at});
        } else {
            res.status(500).json({status: 'error', message: error});
        }
    });

    app.get('/tenant/:tenantId/greenhouse/:greenhouseId/humidity', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /tenant/${tenantId}/greenhouse/${greenhouseId}/humidity] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {success, data, error} = await fetchLatestSensorData(greenhouseId);
        if (success) {
            res.json({status: 'success', humidity: data?.humidity, timestamp: data?.recorded_at});
        } else {
            res.status(500).json({status: 'error', message: error});
        }
    });

    app.get('/tenant/:tenantId/greenhouse/:greenhouseId/window', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /tenant/${tenantId}/greenhouse/${greenhouseId}/window] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {success, data, error} = await fetchLatestWindowStatus(greenhouseId);
        if (success) {
            res.json({
                status: 'success',
                window: data?.status,
                changed_by: data?.changed_by,
                timestamp: data?.recorded_at
            });
        } else {
            res.status(500).json({status: 'error', message: error});
        }
    })

    app.get('/tenant/:tenantId/greenhouse/:greenhouseId/irrigation', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /tenant/${tenantId}/greenhouse/${greenhouseId}/irrigation] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {success, data, error} = await fetchLatestIrrigationStatus(greenhouseId);
        if (success) {
            res.json({
                status: 'success',
                irrigation: data?.status,
                changed_by: data?.changed_by,
                timestamp: data?.recorded_at
            });
        } else {
            res.status(500).json({status: 'error', message: error});
        }
    });

    app.post('/tenant/:tenantId/greenhouse/:greenhouseId/window', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [POST /tenant/${tenantId}/greenhouse/${greenhouseId}/window] called with body:`, req.body);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {window, changed_by = 'user'} = req.body;

        try {
            console.log(`Logging window command to DB for Greenhouse ID: ${greenhouseId}, Command: ${window}`);
            await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .input('Status', sql.VarChar(20), window)
                .input('ChangedBy', sql.VarChar(50), changed_by)
                .query(`
                INSERT INTO window_status (greenhouse_id, status, changed_by)
                VALUES (@GreenhouseId, @Status, @ChangedBy)
            `);
            console.log('Window status logged successfully.');
            res.json({status: 'success', greenhouseId, window});
        } catch (error) {
            console.error('Error in /window POST:', error.message);
            res.status(500).json({status: 'error', message: error.message});
        }
    });

    app.post('/tenant/:tenantId/greenhouse/:greenhouseId/irrigation', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [POST /tenant/${tenantId}/greenhouse/${greenhouseId}/irrigation] called with body:`, req.body);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant or greenhouse ID'});
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }

        const {irrigation, changed_by = 'user'} = req.body;

        try {
            console.log(`Logging irrigation command to DB for Greenhouse ID: ${greenhouseId}, Command: ${irrigation}`);
            await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .input('Status', sql.VarChar(20), irrigation)
                .input('ChangedBy', sql.VarChar(50), changed_by)
                .query(`
                INSERT INTO irrigation_status (greenhouse_id, status, changed_by)
                VALUES (@GreenhouseId, @Status, @ChangedBy)
            `);
            console.log('Irrigation status logged successfully.');
            res.json({status: 'success', greenhouseId, irrigation});
        } catch (error) {
            console.error('Error in /irrigation POST:', error.message);
            res.status(500).json({status: 'error', message: error.message});
        }
    });

    app.get('/arduino/tenant/:tenantId/greenhouse/:greenhouseId/push/:temperature/:humidity', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        const temperature = parseFloat(req.params.temperature);
        const humidity = parseFloat(req.params.humidity);
        const key = req.query.key;

        console.log(`Arduino sensor push: Tenant ${tenantId}, Greenhouse ${greenhouseId}, Temp ${temperature}, Humidity ${humidity}`);

        // Validation
        if (isNaN(tenantId) || isNaN(greenhouseId) || isNaN(temperature) || isNaN(humidity)) {
            return res.status(400).json({status: 'error', message: 'Invalid input parameters'});
        }

        if (key !== ARDUINO_SECRET_KEY) {
            return res.status(403).json({status: 'error', message: 'Unauthorized Arduino request'});
        }

        // Tenancy check
        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).json({status: 'error', message: 'Greenhouse does not belong to tenant'});
        }
        try {
            await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .input('Temperature', sql.Decimal(5, 2), temperature)
                .input('Humidity', sql.Decimal(5, 2), humidity)
                .query(`
                INSERT INTO sensor_data (greenhouse_id, temperature, humidity, recorded_at)
                VALUES (@GreenhouseId, @Temperature, @Humidity, GETDATE())
            `);

            console.log('Sensor data inserted.');
            res.json({status: 'success', greenhouseId, temperature, humidity});
        } catch (error) {
            console.error('SQL error while inserting sensor data:', error.message);
            res.status(500).json({status: 'error', message: error.message});
        }
    });

    app.get('/arduino/tenant/:tenantId/greenhouse/:greenhouseId/window', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /arduino/tenant/${tenantId}/greenhouse/${greenhouseId}/window] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).send('INVALID_ID');
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).send('UNAUTHORIZED');
        }

        const {success, data, error} = await fetchLatestWindowStatus(greenhouseId);
        if (success) {
            res.type('text/plain').send(data?.status || 'UNKNOWN');
        } else {
            res.status(500).send({error: error});
        }
    });

    app.get('/arduino/tenant/:tenantId/greenhouse/:greenhouseId/irrigation', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /arduino/tenant/${tenantId}/greenhouse/${greenhouseId}/irrigation] called.`);

        if (isNaN(tenantId) || isNaN(greenhouseId)) {
            return res.status(400).send('INVALID_ID');
        }

        const valid = await tenancyCheck(tenantId, greenhouseId);
        if (!valid) {
            return res.status(403).send('UNAUTHORIZED');
        }

        const {success, data, error} = await fetchLatestIrrigationStatus(greenhouseId);
        if (success) {
            res.type('text/plain').send(data?.status || 'UNKNOWN');
        } else {
            res.status(500).send({error: error});
        }
    });

    app.get('/tenant/:tenantId/greenhouses', async (req, res) => {
        const tenantId = parseInt(req.params.tenantId, 10);
        console.log(`API [GET /tenant/${tenantId}/greenhouses] called.`);

        if (isNaN(tenantId)) {
            return res.status(400).json({status: 'error', message: 'Invalid tenant ID'});
        }

        try {
            const query = `
            SELECT id, name, location
            FROM greenhouses
            WHERE tenant_id = @TenantId
        `;

            const result = await connectionPool.request()
                .input('TenantId', sql.Int, tenantId)
                .query(query);

            if (result.recordset.length === 0) {
                return res.status(404).json({status: 'error', message: 'No greenhouses found for this tenant'});
            }
            console.log('Greenhouses fetched:', result.recordset);
            res.status(200).json({status: 'success', greenhouses: result.recordset});
        } catch (error) {
            console.error('Error fetching greenhouses:', error);
            res.status(500).json({status: 'error', message: 'Internal server error'});
        }
    });

    app.get('/greenhouse/:greenhouseId/sensors', async (req, res) => {
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /greenhouse/${greenhouseId}/sensors] called.`);

        if (isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid greenhouse ID'});
        }

        try {
            const checkQuery = `SELECT COUNT(*) as count
                            FROM greenhouses
                            WHERE id = @GreenhouseId`;
            const checkResult = await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .query(checkQuery);

            if (checkResult.recordset[0].count === 0) {
                return res.status(404).json({status: 'error', message: 'Greenhouse not found'});
            }
            const query = `
            SELECT temperature,
                   humidity,
                   recorded_at
            FROM sensor_data
            WHERE greenhouse_id = @GreenhouseId
            ORDER BY recorded_at ASC
        `;

            const result = await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .query(query);

            res.json({
                status: 'success',
                data: result.recordset
            });

        } catch (error) {
            console.error('Error fetching sensor data:', error);
            res.status(500).json({status: 'error', message: 'Internal server error'});
        }
    });

    app.get('/greenhouse/:greenhouseId/irrigation-history', async (req, res) => {
        const greenhouseId = parseInt(req.params.greenhouseId, 10);
        console.log(`API [GET /greenhouse/${greenhouseId}/irrigation-history] called.`);

        if (isNaN(greenhouseId)) {
            return res.status(400).json({status: 'error', message: 'Invalid greenhouse ID'});
        }

        try {
            const checkQuery = `
            SELECT COUNT(*) as count
            FROM greenhouses
            WHERE id = @GreenhouseId
        `;
            const checkResult = await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .query(checkQuery);

            if (checkResult.recordset[0].count === 0) {
                return res.status(404).json({status: 'error', message: 'Greenhouse not found'});
            }

            const dataQuery = `
            SELECT status,
                   changed_by,
                   recorded_at
            FROM irrigation_status
            WHERE greenhouse_id = @GreenhouseId
            ORDER BY recorded_at ASC
        `;

            const result = await connectionPool.request()
                .input('GreenhouseId', sql.Int, greenhouseId)
                .query(dataQuery);

            res.json({
                status: 'success',
                data: result.recordset
            });

        } catch (error) {
            console.error('Error fetching irrigation status:', error);
            res.status(500).json({status: 'error', message: 'Internal server error'});
        }
    });

    return app;
}