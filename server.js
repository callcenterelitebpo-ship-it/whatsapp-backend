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
        printQRInTerminal: false
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
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeUrl = '';
            console.log('✅ WhatsApp conectado exitosamente');
        }
    });

    // Reenvío de mensajes entrantes a Lovable con autenticación x-api-key
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
                const text = msg.message?.conversation || 
                             msg.message?.extendedTextMessage?.text || '';

                if (text) {
                    console.log(`📩 Reenviando mensaje de ${phone} a Lovable: ${text}`);

                    const res = await fetch(WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-api-key': API_KEY
                        },
                        body: JSON.stringify({
                            phone: phone,
                            text: text
                        })
                    });

                    console.log(`Respuesta de Lovable: ${res.status}`);
                }
            }
        } catch (err) {
            console.error('Error al enviar webhook a Lovable:', err);
        }
    });
}

// Ruta para estado y QR
app.get('/status', (req, res) => {
    if (connectionStatus === 'connected') {
        res.send('<h2>Estado: connected</h2><p>Servidor activo y sincronizado.</p>');
    } else if (qrCodeUrl) {
        res.send(`<h2>Escanea el código QR</h2><img src="${qrCodeUrl}" /><script>setTimeout(() => location.reload(), 3000);</script>`);
    } else {
        res.send('<h2>Estado: conectando...</h2><script>setTimeout(() => location.reload(), 3000);</script>');
    }
});

// Ruta para enviar mensajes desde Lovable
app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;
        if (!number || !message) {
            return res.status(400).json({ error: 'Faltan campos obligatorios (number, message)' });
        }

        const formattedNumber = number.includes('@s.whatsapp.net') ? number : `${number.replace('+', '')}@s.whatsapp.net`;
        await sock.sendMessage(formattedNumber, { text: message });

        res.json({ status: 'success', message: 'Mensaje enviado' });
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: 'Error interno al enviar mensaje' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    connectToWhatsApp();
});
