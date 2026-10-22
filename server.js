global.crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let connectionStatus = 'disconnected';
let pairingCode = null;

async function connectToWhatsApp() {
    if (fs.existsSync('auth_info_baileys')) {
        // Limpiamos sesión previa para evitar bloqueos
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            pairingCode = null;
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            pairingCode = null;
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Ruta para solicitar el código de emparejamiento ingresando tu número
// Ej: https://tu-backend.onrender.com/pairing-code?phone=51912345678
app.get('/pairing-code', async (req, res) => {
    const phoneNumber = req.query.phone;
    if (!phoneNumber) {
        return res.json({ error: "Por favor incluye tu número. Ejemplo: /pairing-code?phone=51912345678" });
    }

    try {
        if (!sock) {
            return res.json({ error: "El socket aún está iniciando, intenta de nuevo en 10 segundos." });
        }
        
        if(!sock.authState.creds.registered) {
            let code = await sock.requestPairingCode(phoneNumber);
            pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
        }

        res.json({
            estado: connectionStatus,
            codigo_emparejamiento: pairingCode || "Ya registrado o conectado"
        });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.get('/status', (req, res) => {
    res.json({
        estado: connectionStatus,
        conectado: connectionStatus === 'connected'
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    connectToWhatsApp();
});
