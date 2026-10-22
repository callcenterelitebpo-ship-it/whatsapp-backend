global.crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let qrCodeData = null;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'qr_ready';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrCodeData = null;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeData = null;
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', async (req, res) => {
    if (qrCodeData) {
        try {
            const qrImageUrl = await qrcode.toDataURL(qrCodeData);
            return res.json({
                estado: connectionStatus,
                qr: qrImageUrl
            });
        } catch (err) {
            return res.json({
                estado: connectionStatus,
                qr: qrCodeData
            });
        }
    }
    res.json({
        estado: connectionStatus,
        qr: qrCodeData
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    connectToWhatsApp();
});
