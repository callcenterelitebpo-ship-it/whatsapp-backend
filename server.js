const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcodeImage = require('qrcode');

const app = express();
app.use(express.json());

let sock;
let qrCodeData = null;
let isConnected = false;

// URL de tu Webhook en Lovable / Supabase (Reemplaza con tu URL real de Lovable si aplica)
const LOVABLE_WEBHOOK_URL = process.env.LOVABLE_WEBHOOK_URL || '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

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

    // PASO 1: Procesar mensajes entrantes y extraer el número real
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe) {
                    // Extraer el remitente ignorando IDs tipo LID (+44) o multidispositivo
                    let rawJid = msg.key.participant || msg.key.remoteJid || '';
                    
                    // Si viene con formato LID o dispositivo secundario (ej. 51920128799:12@s.whatsapp.net)
                    let cleanPhone = rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');

                    // Si el mensaje viene de un celular local de Perú (9 dígitos), le anteponemos el 51
                    if (cleanPhone.length === 9) {
                        cleanPhone = '51' + cleanPhone;
                    }

                    const messageText = msg.message?.conversation || 
                                        msg.message?.extendedTextMessage?.text || 
                                        '';

                    console.log(`Mensaje recibido de ${cleanPhone}: "${messageText}"`);

                    // Reenviar a Lovable si la URL está configurada
                    if (LOVABLE_WEBHOOK_URL) {
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
        }
    });
}

connectToWhatsApp();

// PASO 2: Endpoint de estado para escanear el QR
app.get('/status', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>Estado: connected</h1><p>Servidor activo y sincronizado.</p>');
    }
    if (qrCodeData) {
        try {
            const qrImageUrl = await qrcodeImage.toDataURL(qrCodeData);
            return res.send(`
                <h1>Escanea el código QR para conectar</h1>
                <img src="${qrImageUrl}" alt="QR Code" />
                <p>Usa la app de WhatsApp Normal para escanear.</p>
            `);
        } catch (err) {
            return res.status(500).send('Error generando imagen del QR');
        }
    }
    res.send('<h1>Iniciando servidor o reconectando...</h1><p>Por favor, recarga en unos segundos.</p>');
});

// PASO 3: Endpoint de salida para enviar respuestas desde Lovable al cliente
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

        // Limpiar caracteres no numéricos
        let cleanedNumber = targetNumber.toString().replace(/\D/g, '');

        // Si es un número peruano de 9 dígitos, anteponer el prefijo 51
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
