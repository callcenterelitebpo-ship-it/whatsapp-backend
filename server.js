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
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Mac OS", "Safari", "17.0"]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            console.log('Conexión cerrada. Reconectando...');
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            console.log('¡WhatsApp Business conectado exitosamente!');
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
            return res.status(503).json({ error: "El servidor está iniciando, espera 10 segundos." });
        }

        // Esperamos a que el socket establezca comunicación
        await new Promise(resolve => setTimeout(resolve, 4000));

        if (!sock.authState.creds.registered) {
            let code = await sock.requestPairingCode(phoneNumber);
            let formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
            return res.json({ estado: connectionStatus, codigo_emparejamiento: formattedCode });
        } else {
            return res.json({ estado: connectionStatus, mensaje: "Este número ya está vinculado y conectado." });
        }
    } catch (err) {
        return res.status(500).json({ error: "No se pudo generar el código. Asegúrate de que el número sea correcto y no tenga restricciones activas en WhatsApp Business." });
    }
});

app.get('/status', (req, res) => {
    res.json({ estado: connectionStatus, conectado: connectionStatus === 'connected' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
