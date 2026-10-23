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

                // CAPTURA ESTRICTA DEL CHAT ID REAL: Usar exactamente el remoteJid del chat actual
                let targetChatJid = msg.key.participant || remoteJid;
                let cleanPhone = '';

                // Extraer los dígitos puros del chat actual sin arrastrar otros números
                const digitsOnly = targetChatJid.replace(/\D/g, '');

                if (digitsOnly.length >= 9) {
                    const last9 = digitsOnly.slice(-9);
                    if (last9.startsWith('9')) {
                        cleanPhone = '51' + last9;
                    } else if (digitsOnly.startsWith('51') && digitsOnly.length >= 11) {
                        const peruSub = digitsOnly.match(/51(9\d{8})/);
                        if (peruSub) {
                            cleanPhone = peruSub[0];
                        }
                    }
                }

                // VALIDACIÓN BLINDADA: Si no es un número peruano exacto de este chat, se omite
                if (!cleanPhone || !cleanPhone.startsWith('519') || cleanPhone.length !== 11) {
                    console.log(`[BLOQUEADO] Chat ignorado por no pertenecer a un móvil peruano válido: ${targetChatJid}`);
                    continue;
                }

                const messageText = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    '';

                console.log(`[CHAT AISLADO Y SEGURO] Teléfono del Chat: ${cleanPhone} | Mensaje: ${messageText}`);

                // Enviamos a Lovable asociando de manera directa e inalterable el teléfono del chat actual
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
        return res.send('<h1>Estado: CONECTADO</h1><p>El bot responde única y exclusivamente al número exacto del chat actual.</p>');
    }
    if (qrCodeData) {
        try {
            const qrImageUrl = await qrcodeImage.toDataURL(qrCodeData);
            return res.send(`
                <h1>Escanea el código QR en tu WhatsApp</h1>
                <img src="${qrImageUrl}" alt="QR Code" width="300" />
                <p>Usa la app de WhatsApp para escanear.</p>
            `);
        } catch (err) {
            return res.status(500).send('Error generando QR');
        }
    }
    res.send('<h1>Iniciando sesión...</h1><p>Recarga la página en unos segundos.</p>');
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

        // RESPUESTA AL MISMO NÚMERO DE CHAT: Se arma el JID exactamente con el número que solicita el envío
        const jid = `${cleanedNumber}@s.whatsapp.net`;

        console.log(`[ENVÍO EXACTO] Respondiendo al mismo número de chat: ${jid}`);

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
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
