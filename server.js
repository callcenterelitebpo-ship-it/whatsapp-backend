const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeUrl = '';
let connectionStatus = 'disconnected';

const WEBHOOK_URL = 'https://elitebpomultiagenteatencionchat.lovable.app/api/public/whatsapp/bridge?key=vqf4r9fniQubMstVdI-tflLoXttpLFjj';
const API_KEY = 'vqf4r9fniQubMstVdI-tflLoXttpLFjj';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeUrl = await QRCode.toDataURL(qr);
            connectionStatus = 'connecting';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrCodeUrl = '';
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeUrl = '';
            console.log('✅ WhatsApp conectado exitosamente');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || msg.key.fromMe || m.type !== 'notify') return;

            const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || '';

            if (!text) return;

            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify({ phone, text })
            });

        } catch (err) {
            console.error('Error al reenviar webhook:', err.message);
        }
    });
}

// Prevenir que Render se duerma
setInterval(() => {
    fetch('https://whatsapp-backend-u9nh.onrender.com/status').catch(() => {});
}, 240000);

app.get('/status', (req, res) => {
    res.send(`Estado: ${connectionStatus}`);
});

app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;
        if (!number || !message) return res.status(400).json({ error: 'Faltan campos' });

        const formattedNumber = number.includes('@s.whatsapp.net') ? number : `${number.replace('+', '')}@s.whatsapp.net`;
        await sock.sendMessage(formattedNumber, { text: message });

        res.json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    connectToWhatsApp();
});
