const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcodeImage = require('qrcode');

const app = express();
app.use(express.json());

let sock;
let qrCodeData = null;
let isConnected = false;

const LOVABLE_WEBHOOK_URL = process.env.LOVABLE_WEBHOOK_URL || '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session_elite');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['ELITE BPO', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            isConnected = false;
            console.log('NUEVO QR GENERADO. Escanear en /status');
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null;
            console.log('¡CONEXIÓN EXITOSA CON WHATSAPP!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (!m.messages || m.messages.length === 0) return;

            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;

                const remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

                // Extraer los dígitos limpios
                let rawSource = msg.key.participant || remoteJid;
                let digits = rawSource.replace(/\D/g, '');
                let cleanPhone = '';

                // Extraer el número peruano real
                if (digits.length >= 9) {
                    const last9 = digits.slice(-9);
                    if (last9.startsWith('9')) {
                        cleanPhone = '51' + last9;
                    } else {
                        cleanPhone = digits;
                    }
                } else {
                    cleanPhone = digits;
                }

                if (!cleanPhone) continue;

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    '';

                console.log(`[ENTRANTE] Cliente: ${cleanPhone} | Mensaje: ${messageText}`);

                // Enviar SIEMPRE a Lovable sin bloquear
                if (LOVABLE_WEBHOOK_URL && messageText) {
                    await fetch(LOVABLE_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            phone: cleanPhone,
                            message: messageText,
                            raw: msg
                        })
                    });
                }
            }
        } catch (err) {
            console.error('Error procesando mensajes:', err.message);
        }
    });
}

connectToWhatsApp();

app.get('/status', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>Estado: CONECTADO</h1><p>El bot está activo y recibiendo mensajes.</p>');
    }
    if (qrCodeData) {
        try {
            const qrImageUrl = await qrcodeImage.toDataURL(qrCodeData);
            return res.send(`
                <h1>Escanea el código QR en tu WhatsApp</h1>
                <img src="${qrImageUrl}" alt="QR Code" width="300" />
                <p>Abre WhatsApp -> Dispositivos vinculados -> Vincular un dispositivo.</p>
            `);
        } catch (err) {
            return res.status(500).send('Error generando el código QR');
        }
    }
    res.send('<h1>Conectando con WhatsApp...</h1><p>Recarga esta página en 5 segundos.</p>');
});

app.post('/send-message', async (req, res) => {
    try {
        let { number, phone, message } = req.body;
        let targetNumber = number || phone;

        if (!targetNumber || !message) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        if (!isConnected || !sock) {
            return res.status(503).json({ error: 'WhatsApp desconectado. Entra a /status para vincular.' });
        }

        let cleanedNumber = targetNumber.toString().replace(/\D/g, '');
        if (cleanedNumber.length === 9) {
            cleanedNumber = '51' + cleanedNumber;
        }

        const jid = `${cleanedNumber}@s.whatsapp.net`;

        const urlMatch = typeof message === 'string' ? message.match(/(https?:\/\/[^\s]+\b(?:supabase\.co\/storage|\.(?:jpeg|jpg|png|webp))[^\s]*)/i) : null;

        if (urlMatch) {
            const imageUrl = urlMatch[0];
            const captionText = message.replace(imageUrl, '').trim();

            await sock.sendMessage(jid, { 
                image: { url: imageUrl },
                caption: captionText || '' 
            });
        } else {
            await sock.sendMessage(jid, { text: message });
        }

        res.status(200).json({ status: 'success', sentTo: jid });

    } catch (error) {
        console.error('Error enviando mensaje:', error);
        res.status(500).json({ error: 'Error al enviar', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
