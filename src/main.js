const express = require('express');
const axios = require('axios');
const app = express();
require('dotenv').config();

app.use(express.json());

const PORT = process.env.SERVER_PORT || 3000;
const MASTER_URL = `http://${process.env.MASTER_IP}`;

const fetchFromMaster = async (endpoint) => {
    try {
        const {data} = await axios.get(`${MASTER_URL}${endpoint}`);
        return {success: true, data};
    } catch (error) {
        return {success: false, error: error.message};
    }
}

const createGetHandler = (endpoint) => {
    return async (req, res) => {
        const {success, data, error} = await fetchFromMaster(endpoint);
        res.status(success ? 200 : 500).json(
            success ? {status: 'success', [endpoint.slice(1)]: data} : {error}
        );
    };
}

app.get('/', (req, res ) => res.json({message: 'greenhouse-manager'}));
app.get('/window', createGetHandler('/window'));
app.get('/humidity', createGetHandler('/humidity'));
app.get('/temperature', createGetHandler('/temperature'));

app.post('/window', async (req, res) => {
    const {window} = req.body;
    const {success, data} = await fetchFromMaster('/window', {window});
    res.status(success ? 200 : 500).json(
        success ? {status: 'success', window, response: data} : {status: 'error', message: data.error}
    );
});

app.listen(PORT, () => console.log(`NodeJS API running on port ${PORT}`));
