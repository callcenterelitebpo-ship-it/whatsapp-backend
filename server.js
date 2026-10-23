const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcodeImage = require('qrcode');
 
const app = express();
app.use(express.json());
 
let sock;
let qrCodeData = null;
let isConnected = false;
 
const LOVABLE_WEBHOOK_URL = process.env.LOVABLE_WEBHOOK_URL || '';
const SEND_API_KEY = process.env.SEND_API_KEY || ''; // opcional pero recomendado
const AUTH_DIR = process.env.AUTH_DIR || 'auth_session_elite'; // en Render, apuntar al disco persistente
 
// ---------- Memoria de mensajes enviados (necesaria para reintentos de cifrado) ----------
// WhatsApp pide reenviar un mensaje cuando el cliente no pudo descifrarlo
// ("Esperando mensaje..."). getMessage permite devolverlo.
const sentMessages = new Map();
const MAX_STORED = 1000;
const processedIds = new Set(); // evita procesar dos veces el mismo mensaje entrante
 
function rememberSent(sent) {
    if (sent?.key?.id && sent.message) {
        sentMessages.set(sent.key.id, sent.message);
        if (sentMessages.size > MAX_STORED) {
            const oldest = sentMessages.keys().next().value;
            sentMessages.delete(oldest);
        }
    }
}
 
// ---------- Utilidades ----------
 
// Quita el sufijo de dispositivo (":12") y el dominio ("@s.whatsapp.net" / "@lid")
function digitsFromJid(jid) {
    return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}
 
// Obtiene el número REAL de teléfono. WhatsApp ahora puede entregar el chat
// como "@lid" (un ID interno de 14-15 dígitos que NO es un teléfono).
async function resolvePhone(key) {
    const candidates = [
        key.senderPn,
        key.participantPn,
        key.remoteJidAlt,
        key.participantAlt,
        key.participant,
        key.remoteJid
    ].filter(Boolean);
 
    // 1) Cualquier candidato que sea un JID de teléfono real
    const pnJid = candidates.find(j => j.endsWith('@s.whatsapp.net'));
    if (pnJid) return digitsFromJid(pnJid);
 
    // 2) Si solo hay LID, intentar traducirlo (disponible en Baileys v7)
    const lidJid = candidates.find(j => j.endsWith('@lid'));
    if (lidJid) {
        try {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
            if (pn) return digitsFromJid(pn);
        } catch (e) {
            console.log('No se pudo resolver LID:', e.message);
        }
    }
    return null; // No inventamos ningún número
}
 
// ---------- Conexión a WhatsApp ----------
 
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
 
    // Usa la versión más reciente del protocolo de WhatsApp; si falla, usa la del paquete instalado
    let version;
    try {
        ({ version } = await fetchLatestBaileysVersion());
    } catch (e) {
        console.log('No se pudo obtener la última versión de WhatsApp, se usa la del paquete:', e.message);
    }
 
    sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        printQRInTerminal: true,
        browser: ['ELITE BPO', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false, // evita que el bot "robe" las notificaciones del teléfono
        getMessage: async (key) => sentMessages.get(key.id)
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Código:', statusCode, '| Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000); // pausa corta para evitar bucles de reconexión
            } else {
                console.log('Sesión cerrada desde el teléfono. Borra la carpeta de sesión y escanea el QR de nuevo en /status.');
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null;
            console.log('¡CONEXIÓN EXITOSA CON WHATSAPP!');
        }
    });
 
    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (m.type !== 'notify') return; // ignora historial y sincronizaciones
            if (!m.messages || m.messages.length === 0) return;
 
            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;
 
                if (msg.key.id) {
                    if (processedIds.has(msg.key.id)) continue;
                    processedIds.add(msg.key.id);
                    if (processedIds.size > 2000) processedIds.delete(processedIds.values().next().value);
                }
 
                const remoteJid = msg.key.remoteJid || '';
                if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;
 
                const messageText = msg.message?.conversation ||
                                    msg.message?.extendedTextMessage?.text ||
                                    msg.message?.imageMessage?.caption ||
                                    '';
                if (!messageText) continue;
 
                // Número real (sin recortar ni agregar prefijos)
                const phone = await resolvePhone(msg.key);
 
                console.log(`[ENTRANTE] jid: ${remoteJid} | phone: ${phone} | Texto: ${messageText}`);
 
                if (LOVABLE_WEBHOOK_URL) {
                    await fetch(LOVABLE_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            phone,                    // número real o null
                            jid: remoteJid,           // identificador exacto del chat: usar para responder
                            name: msg.pushName || '',
                            message: messageText
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
 
// ---------- Rutas ----------
 
app.get('/status', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>Estado: CONECTADO</h1><p>El servidor está activo y recibiendo mensajes.</p>');
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
    res.send('<h1>Iniciando...</h1><p>Recarga la página en unos segundos.</p>');
});
 
app.post('/send-message', async (req, res) => {
    try {
        if (SEND_API_KEY && req.headers['x-api-key'] !== SEND_API_KEY) {
            return res.status(401).json({ error: 'No autorizado' });
        }
 
        const { jid: bodyJid, number, phone, message } = req.body;
        const target = bodyJid || number || phone;
 
        if (!target || !message) {
            return res.status(400).json({ error: 'Faltan datos obligatorios (jid o number, y message)' });
        }
 
        if (!isConnected || !sock) {
            return res.status(503).json({ error: 'WhatsApp no está conectado. Revisa /status' });
        }
 
        let jid;
        if (bodyJid && String(bodyJid).includes('@')) {
            // Responder EXACTAMENTE al chat del que llegó el mensaje
            jid = String(bodyJid);
        } else {
            let digits = String(target).replace(/\D/g, '');
            if (digits.length === 9) digits = '51' + digits; // solo si es un celular peruano de 9 dígitos
            jid = `${digits}@s.whatsapp.net`;
        }
 
        console.log(`[ENVÍO] Respondiendo a: ${jid}`);
 
        const urlMatch = typeof message === 'string'
            ? message.match(/(https?:\/\/[^\s]+\b(?:supabase\.co\/storage|\.(?:jpeg|jpg|png|webp))[^\s]*)/i)
            : null;
 
        let sent;
        if (urlMatch) {
            const imageUrl = urlMatch[0];
            const captionText = message.replace(imageUrl, '').trim();
            sent = await sock.sendMessage(jid, { image: { url: imageUrl }, caption: captionText || '' });
        } else {
            sent = await sock.sendMessage(jid, { text: message });
        }
        rememberSent(sent);
 
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
