const express = require('express');
const app = express();

const PORT = 80;
let windowState = 1;

app.use(express.json());

const randomValue = () => Math.floor(Math.random() * 90 + 10);

app.post('/window', (req, res) => {
    windowState = req.body.window;
    res.send("OK");
});

app.get('/window', (req, res) => res.send(windowState.toString()));
app.get('/humidity', (req, res) => res.send(randomValue().toString()));
app.get('/temperature', (req, res) => res.send(randomValue().toString()));

app.listen(PORT, () => console.log(`Simülasyon çalışıyor: http://localhost:${PORT}`));