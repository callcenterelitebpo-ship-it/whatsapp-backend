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

async function connectToWhatsApp() {
    // Limpiamos sesión previa para generar un nuevo registro limpio
    if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
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
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

app.get('/pairing-code', async (req, res) => {
    const phoneNumber = req.query.phone;
    if (!phoneNumber) {
        return res.json({ error: "Incluye tu número: /pairing-code?phone=519TU_NUMERO" });
    }

    try {
        if (!sock) {
            return res.status(503).json({ error: "Reiniciando socket, intenta de nuevo en 5 segundos." });
        }

        // Damos 5 segundos para que conecte con los servidores de WhatsApp antes de pedir el código
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (!sock.authState.creds.registered) {
            let code = await sock.requestPairingCode(phoneNumber);
            let formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
            return res.json({ estado: connectionStatus, codigo_emparejamiento: formattedCode });
        } else {
            return res.json({ estado: connectionStatus, mensaje: "Ya está registrado." });
        }
    } catch (err) {
        return res.status(500).json({ error: "Error al generar. Vuelve a recargar el enlace." });
    }
});

app.get('/status', (req, res) => {
    res.json({ estado: connectionStatus, conectado: connectionStatus === 'connected' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
