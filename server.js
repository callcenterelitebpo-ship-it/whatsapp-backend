const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = '';
let connectionStatus = 'disconnected';

const WEBHOOK_URL = 'https://elitebpomultiagenteatencionchat.lovable.app/api/public/whatsapp/bridge?key=vqf4r9fniQubMstVdI-tflLoXttpLFjj';
const API_KEY = 'vqf4r9fniQubMstVdI-tflLoXttpLFjj';

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
            qrCodeData = qr;
            connectionStatus = 'connecting';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrCodeData = '';
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
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

            const phone = msg.key.remoteJid ? msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '') : '';
            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || '';

            if (!phone || !text) return;

            console.log(`📩 Mensaje recibido de ${phone}: "${text}". Reenviando a Lovable...`);

            const payload = {
                phone: phone,
                text: text,
                from: phone,
                pushName: msg.pushName || 'Cliente'
            };

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify(payload)
            });

            const resText = await response.text();
            console.log(`📡 Respuesta Webhook Lovable (Status ${response.status}):`, resText);

        } catch (err) {
            console.error('❌ Error al reenviar mensaje:', err.message);
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
