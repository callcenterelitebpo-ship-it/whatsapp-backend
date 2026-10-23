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
            console.log('Nuevo código QR generado en /status');
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

                let remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

                let cleanPhone = '';

                // 1. Extraer identificadores del mensaje
                const participant = msg.key.participant || msg.participant || '';
                const senderJid = participant || remoteJid;

                // 2. Si el JID contiene un LID (ej: @lid o número largo que no es PN)
                const stringifiedMsg = JSON.stringify(msg);

                // Buscar patrón de celular peruano de 9 dígitos que empieza con 9 dentro del paquete completo
                const peruMatches = stringifiedMsg.match(/9\d{8}/g);

                if (peruMatches && peruMatches.length > 0) {
                    // Filtrar coincidencias para asegurar que tomamos un número válido
                    for (const match of peruMatches) {
                        if (match.length === 9) {
                            cleanPhone = '51' + match;
                            break;
                        }
                    }
                }

                // 3. Si no se encontró en el paquete JSON, evaluar los dígitos directos del remitente
                if (!cleanPhone) {
                    const rawDigits = senderJid.replace(/\D/g, '');
                    if (rawDigits.startsWith('51') && rawDigits.length === 11) {
                        cleanPhone = rawDigits;
                    } else if (rawDigits.length >= 9) {
                        const last9 = rawDigits.slice(-9);
                        if (last9.startsWith('9')) {
                            cleanPhone = '51' + last9;
                        }
                    }
                }

                // 4. CORRECCIÓN ABSOLUTA Y FILTRO DE HIERRO:
                // Si el número sigue empezando con 44 o NO tiene exactamente 11 dígitos con prefijo 519,
                // ES UN LID INTERNO SIN TELÉFONO PÚBLICO Y SE BLOQUEA TOTALMENTE.
                if (!cleanPhone || cleanPhone.startsWith('44') || !cleanPhone.startsWith('519') || cleanPhone.length !== 11) {
                    console.log(`[BLOQUEADO] Se previno la creación de chat inválido para JID: ${senderJid}`);
                    continue; // NO avanza hacia Lovable
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    '';

                console.log(`[EXITO] Teléfono Peruano Confirmado: ${cleanPhone} | Texto: ${messageText}`);

                // 5. Enviar únicamente cuando el número peruano de 11 dígitos está 100% verificado
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
            console.error('Error en procesamiento de mensajes:', err.message);
        }
    });
}

connectToWhatsApp();

app.get('/status', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>Estado: CONECTADO</h1><p>El bot está activo y procesando únicamente números peruanos reales.</p>');
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
            return res.status(500).send('Error generando QR');
        }
    }
    res.send('<h1>Conectando...</h1><p>Recarga la página en unos segundos.</p>');
});

app.post('/send-message', async (req, res) => {
    try {
        let { number, phone, message } = req.body;
        let targetNumber = number || phone;

        if (!targetNumber || !message) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        if (!isConnected || !sock) {
            return res.status(503).json({ error: 'WhatsApp no está conectado. Revisa /status' });
        }

        let cleanedNumber = targetNumber.toString().replace(/\D/g, '');
        if (cleanedNumber.length === 9) {
            cleanedNumber = '51' + cleanedNumber;
        }

        const jid = `${cleanedNumber}@s.whatsapp.net`;

        console.log(`Despachando respuesta a cliente peruano: ${jid}`);

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
        res.status(500).json({ error: 'Error al enviar', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor iniciado en el puerto ${PORT}`);
});
