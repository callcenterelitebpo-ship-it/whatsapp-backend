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
            console.log('Nuevo código QR generado.');
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
            console.log('¡Conexión establecida con éxito con WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (!m.messages || m.messages.length === 0) return;

            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;

                let remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

                // EXTRACCIÓN DIRECTA Y OBLIGATORIA DEL NÚMERO REAL
                let senderJid = msg.key.participant || remoteJid;
                let cleanPhone = '';

                // Si el remitente viene con sufijo de red oficial de WhatsApp
                if (senderJid.includes('@s.whatsapp.net')) {
                    const digits = senderJid.split('@')[0].replace(/\D/g, '');
                    // Si es un número peruano válido de 9 dígitos o con 51
                    if (digits.length === 9 && digits.startsWith('9')) {
                        cleanPhone = '51' + digits;
                    } else if (digits.startsWith('51') && digits.length === 11) {
                        cleanPhone = digits;
                    } else if (digits.length > 11) {
                        // Extraer los últimos 9 dígitos si empiezan con 9 (ignorando LIDs extranjeros)
                        const last9 = digits.slice(-9);
                        if (last9.startsWith('9')) {
                            cleanPhone = '51' + last9;
                        }
                    }
                }

                // VALIDADOR ABSOLUTO: Si no se logró extraer una línea peruana que empiece con 519, 
                // descartamos el mensaje para no registrar números falsos (+44 u otros países)
                if (!cleanPhone || !cleanPhone.startsWith('519') || cleanPhone.length !== 11) {
                    console.log(`Mensaje descartado por no ser número peruano válido: ${senderJid}`);
                    continue;
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    '';

                console.log(`¡NÚMERO REAL CAPTURADO EXITOSAMENTE!: ${cleanPhone} | Mensaje: ${messageText}`);

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
            console.error('Error procesando mensaje:', err.message);
        }
    });
}

connectToWhatsApp();

app.get('/status', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>Estado: connected</h1><p>Servidor activo y sincronizado.</p>');
    }
    if (qrCodeData) {
        try {
            const qrImageUrl = await qrcodeImage.toDataURL(qrCodeData);
            return res.send(`
                <h1>Escanea el código QR para conectar</h1>
                <img src="${qrImageUrl}" alt="QR Code" width="300" />
                <p>Usa la app de WhatsApp para escanear.</p>
            `);
        } catch (err) {
            return res.status(500).send('Error generando imagen del QR');
        }
    }
    res.send('<h1>Iniciando servidor...</h1><p>Recarga en unos segundos.</p>');
});

app.post('/send-message', async (req, res) => {
    try {
        let { number, phone, message } = req.body;
        let targetNumber = number || phone;

        if (!targetNumber || !message) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        if (!isConnected || !sock) {
            return res.status(503).json({ error: 'WhatsApp no está conectado. Revisa /status' });
        }

        let cleanedNumber = targetNumber.toString().replace(/\D/g, '');
        if (cleanedNumber.length === 9) {
            cleanedNumber = '51' + cleanedNumber;
        }

        const jid = `${cleanedNumber}@s.whatsapp.net`;

        console.log(`Despachando mensaje directo al JID correcto: ${jid}...`);

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
        console.error('Error en /send-message:', error);
        res.status(500).json({ error: 'Error al enviar mensaje', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
