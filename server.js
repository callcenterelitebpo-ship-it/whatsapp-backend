const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let currentQr = null;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQr = await QRCode.toDataURL(qr);
            connectionStatus = 'connecting';
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            currentQr = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            currentQr = null;
            console.log('✅ Conexión con WhatsApp lista');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log('Mensaje entrante:', msg);
        }
    });
}

app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: currentQr });
});

app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    try {
        const jid = `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

connectToWhatsApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de WhatsApp corriendo en puerto ${PORT}`));
