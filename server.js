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
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;

                let remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

                // Extraer el identificador base del emisor
                let rawSender = msg.key.participant || remoteJid;
                let cleanPhone = rawSender.replace(/\D/g, '');

                // Si viene de un formato largo o LID, extraer los 9 dígitos peruanos correctos
                if (cleanPhone.length > 9) {
                    // Buscar si contiene el 51 explícito
                    if (cleanPhone.includes('51')) {
                        const idx = cleanPhone.indexOf('51');
                        const potential = cleanPhone.slice(idx, idx + 11);
                        if (potential.startsWith('519') && potential.length === 11) {
                            cleanPhone = potential;
                        }
                    }
                    
                    // Si no, tomar los últimos 9 dígitos si empiezan con 9
                    if (cleanPhone.length !== 11) {
                        const last9 = cleanPhone.slice(-9);
                        if (last9.startsWith('9')) {
                            cleanPhone = '51' + last9;
                        }
                    }
                } else if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
                    cleanPhone = '51' + cleanPhone;
                }

                // Validación final flexible para asegurar que sea un número peruano operativo
                if (!cleanPhone.startsWith('519') || cleanPhone.length !== 11) {
                    console.log(`Ajustando formato alternativo para: ${rawSender}`);
                    // Si el emisor trae un identificador que no pudimos mapear directo, 
                    // intentamos usar el remoteJid original limpiando los números finales
                    const fallbackDigits = remoteJid.replace(/\D/g, '');
                    if (fallbackDigits.length >= 9) {
                        const f9 = fallbackDigits.slice(-9);
                        if (f9.startsWith('9')) {
                            cleanPhone = '51' + f9;
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    '';

                console.log(`Mensaje recibido correctamente - Cliente: ${cleanPhone} | Texto: ${messageText}`);

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

        console.log(`Despachando mensaje al número peruano: ${jid}...`);

        const urlMatch = typeof message === 'string' ? message.match(/(https?:\/\/[^\s]+\b(?:supabase\.co\/storage|\.(?:jpeg|jpg|png|webp))[^\s]*)/i) : null;

        if (urlMatch) {
            const imageUrl = urlMatch[0];
            const captionText = message.replace(imageUrl, '').trim();

            await sock.sendMessage(jid, { 
                image: { url: imageUrl },
                caption: captionText || '' 
            });
            console.log(`Imagen multimedia enviada correctamente a ${jid}`);
        } else {
            await sock.sendMessage(jid, { text: message });
            console.log(`Texto enviado correctamente a ${jid}`);
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
