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
                // Ignorar mensajes enviados por el propio bot de forma absoluta
                if (msg.key.fromMe) continue;

                let senderJid = msg.key.remoteJid || '';

                // Descartar chats de estado o grupos y asegurar que sea chat privado de usuario
                if (senderJid.includes('@g.us') || senderJid === 'status@broadcast') continue;

                // Si trae LID o identificadores extra, buscar el participante o limpiar
                if (msg.key.participant) {
                    senderJid = msg.key.participant;
                } else if (msg.participant) {
                    senderJid = msg.participant;
                }

                let cleanPhone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');

                // Si el número detectado es el identificador extraño +44... o viene vacío/inválido, 
                // lo filtramos y evitamos enviarlo para que no ensucie el CRM con números falsos.
                if (cleanPhone.startsWith('44') || cleanPhone.length < 9) {
                    console.log(`Mensaje ignorado por pertenecer a LID/sistema: ${senderJid}`);
                    continue;
                }

                // Estandarización estricta para números de Perú (9 dígitos o 51 + 9 dígitos)
                if (cleanPhone.length === 9) {
                    cleanPhone = '51' + cleanPhone;
                } else if (cleanPhone.length > 11 && cleanPhone.startsWith('51')) {
                    cleanPhone = cleanPhone.slice(-11);
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    '';

                console.log(`Mensaje de cliente válido - Teléfono: ${cleanPhone}`);

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

        console.log(`Despachando mensaje a ${jid}...`);

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
