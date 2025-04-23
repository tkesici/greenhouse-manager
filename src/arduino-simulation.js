const express = require('express');
const app = express();

const SIMULATION_HOST = process.env.WEBSITE_HOSTNAME || 'localhost';
const SIMULATION_PORT =  process.env.SIMULATION_PORT || 80;
const PROTOCOL = SIMULATION_HOST === 'localhost' ? 'http' : 'https';

let windowState = 1;

app.use(express.json());

const randomValue = () => Math.floor(Math.random() * 90 + 10);

app.get('/', (req, res ) => res.json({message: 'arduino-simulation'}));

app.post('/window', (req, res) => {
    windowState = req.body.window;
    console.log('Window state set to:', windowState)
    res.send("OK");
});

app.get('/window', (req, res) => {
    windowState = Math.random() < 0.5 ? 0 : 1;
    res.send(windowState.toString())
});
app.get('/humidity', (req, res) => res.send(randomValue().toString()));
app.get('/temperature', (req, res) => res.send(randomValue().toString()));

app.listen(SIMULATION_PORT, () => console.log(`Simulation is working on: ${PROTOCOL}://${SIMULATION_HOST}:${SIMULATION_PORT}`));
