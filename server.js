global.crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let latestQrImage = null;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    // Si existe una sesión corrupta previa, la limpiamos para forzar el QR inmediatamente
    if (connectionStatus === 'disconnected' && !latestQrImage) {
        try {
            if (fs.existsSync('auth_info_baileys')) {
                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            }
        } catch (e) {
            console.log('Error limpiando carpeta de auth:', e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'qr_ready';
            try {
                // Convertimos el QR a una imagen base64 completa
                latestQrImage = await qrcode.toDataURL(qr);
                console.log('¡Código QR generado correctamente!');
            } catch (err) {
                console.error('Error generando DataURL del QR:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            latestQrImage = null;

            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            latestQrImage = null;
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Ruta principal para ver el QR como imagen HTML o JSON
app.get('/status', (req, res) => {
    if (latestQrImage) {
        // Devuelve una página HTML simple con el código QR para escanear directo
        return res.send(`
            <html>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                    <h2>Escanea este código QR con WhatsApp</h2>
                    <img src="${latestQrImage}" style="border: 4px solid white; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" />
                    <p>Estado: <strong>${connectionStatus}</strong></p>
                </body>
            </html>
        `);
    }

    res.json({
        estado: connectionStatus,
        qr: null,
        mensaje: connectionStatus === 'connected' ? 'WhatsApp ya está conectado.' : 'Generando QR, recarga en 5 segundos...'
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
    connectToWhatsApp();
});
