const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = '';
let connectionStatus = 'disconnected';

const WEBHOOK_URL = 'https://elitebpomultiagenteatencionchat.lovable.app/api/public/whatsapp/bridge?key=vqf4r9fniQubMstVdI-tflLoXttpLFjj';
const API_KEY = 'vqf4r9fniQubMstVdI-tflLoXttpLFjj';

async function connectToWhatsApp() {
    const sessionPath = './auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'connecting';
            console.log('📱 Nuevo código QR generado.');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrCodeData = '';

            console.log(`❌ Conexión cerrada. Código de error: ${statusCode}`);

            // Si hay conflicto, cierre de sesión o error de autenticación, limpiamos la sesión
            if (statusCode === DisconnectReason.loggedOut || statusCode === 440 || statusCode === 515) {
                try {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log('🧹 Sesión limpiada por error crítico.');
                } catch (e) {}
            }

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            } else {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeData = '';
            console.log('✅ WhatsApp conectado exitosamente');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid || '';
            const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^0-9]/g, '');
            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || '';

            if (!phone || !text) return;

            console.log(`📩 Procesando mensaje de ${phone}: "${text}"`);

            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify({ phone, text, from: phone, pushName: msg.pushName || 'Cliente' })
            });

        } catch (err) {
            console.error('❌ Error en webhook:', err.message);
        }
    });
}

app.get('/status', async (req, res) => {
    if (connectionStatus === 'connected') {
        return res.send('<h2>Estado: connected</h2><p>Servidor activo y sincronizado.</p>');
    }
    
    if (qrCodeData) {
        try {
            const qrImage = await QRCode.toDataURL(qrCodeData);
            return res.send(`<h2>Escanea el código QR</h2><img src="${qrImage}" /><script>setTimeout(() => location.reload(), 3000);</script>`);
        } catch (e) {
            return res.send(`<h2>Código QR</h2><p>${qrCodeData}</p>`);
        }
    }

    res.send('<h2>Estado: conectando...</h2><script>setTimeout(() => location.reload(), 3000);</script>');
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
