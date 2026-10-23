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
        browser: ['Chrome (Linux)', 'Chrome', '10.0.0']
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
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;

                let remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

                // Capturar de forma limpia el número, evitando que los LIDs suplanten el número real
                let cleanPhone = '';

                // Si el mensaje trae el contacto o participante real en el payload
                const rawSender = msg.key.participant || msg.participant || remoteJid;
                const digitsOnly = rawSender.replace(/\D/g, '');

                // Buscar específicamente un número celular peruano válido dentro de los dígitos (empieza con 9 y tiene 9 dígitos)
                const matchPeru = digitsOnly.match(/9\d{8}/);
                if (matchPeru) {
                    cleanPhone = '51' + matchPeru[0];
                } else if (digitsOnly.length >= 9) {
                    // Si no encuentra el patrón exacto, toma los últimos 9 dígitos si empiezan con 9
                    const last9 = digitsOnly.slice(-9);
                    if (last9.startsWith('9')) {
                        cleanPhone = '51' + last9;
                    } else {
                        cleanPhone = digitsOnly;
                    }
                } else {
                    cleanPhone = digitsOnly;
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    '';

                console.log(`Mensaje entrante - Remitente original: ${rawSender} | Teléfono peruano real enviado a Lovable: ${cleanPhone}`);

                if (LOVABLE_WEBHOOK_URL && messageText) {
                    try {
                        await fetch(LOVABLE_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                phone: cleanPhone,
                                message: messageText,
                                raw: msg
                            })
                        });
                    } catch (err) {
                        console.error('Error enviando webhook a Lovable:', err.message);
                    }
                }
            }
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
                <p>Usa la app de WhatsApp Normal para escanear.</p>
            `);
        } catch (err) {
            return res.status(500).send('Error generando imagen del QR');
        }
    }
    res.send('<h1>Iniciando servidor o reconectando...</h1><p>Por favor, recarga en unos segundos.</p>');
});

app.post('/send-message', async (req, res) => {
    try {
        let { number, phone, message } = req.body;
        let targetNumber = number || phone;

        if (!targetNumber || !message) {
            return res.status(400).json({ error: 'Faltan campos obligatorios: number/phone y message' });
        }

        if (!isConnected || !sock) {
            return res.status(503).json({ error: 'WhatsApp no está conectado. Revisa /status' });
        }

        let cleanedNumber = targetNumber.toString().replace(/\D/g, '');

        if (cleanedNumber.length === 9) {
            cleanedNumber = '51' + cleanedNumber;
        }

        const jid = `${cleanedNumber}@s.whatsapp.net`;

        console.log(`Despachando mensaje al JID correcto: ${jid}...`);

        await sock.sendMessage(jid, { text: message });

        console.log(`Mensaje entregado con éxito a ${jid}`);
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
