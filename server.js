global.crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let qrImageUrl = null;
let connectionStatus = 'disconnected';
let isInitializing = false;

async function connectToWhatsApp() {
    if (isInitializing) return;
    isInitializing = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Windows', 'Chrome', '122.0.2365.92'],
            markOnlineOnConnect: false,
            generateHighQualityQR: true,
            syncFullHistory: false
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connectionStatus = 'qr_ready';
                try {
                    qrImageUrl = await qrcode.toDataURL(qr, { margin: 4, scale: 8 });
                    console.log('¡Código QR generado con éxito!');
                } catch (err) {
                    console.error('Error generando QR:', err);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                connectionStatus = 'disconnected';
                qrImageUrl = null;
                sock = null;
                isInitializing = false;
                
                if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(), 5000);
                }
            } else if (connection === 'open') {
                connectionStatus = 'connected';
                qrImageUrl = null;
                isInitializing = false;
                console.log('¡Conectado a WhatsApp exitosamente!');
            }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch (e) {
        isInitializing = false;
    }
}

app.get('/status', async (req, res) => {
    if (!sock && !isInitializing && connectionStatus === 'disconnected') {
        connectToWhatsApp();
    }

    if (qrImageUrl) {
        return res.send(`
            <html>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                    <h2>Escanea este código QR con tu WhatsApp</h2>
                    <div style="background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
                        <img src="${qrImageUrl}" style="display: block; width: 320px; height: 320px;" />
                    </div>
                    <p style="margin-top: 20px;">Estado: <strong>${connectionStatus}</strong></p>
                    <script>
                        setTimeout(() => { window.location.reload(); }, 30000);
                    </script>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                <h3>Estado: ${connectionStatus}</h3>
                <p>Generando instancia en la nube, la página se recargará automáticamente...</p>
                <script>
                    setTimeout(() => { window.location.reload(); }, 5000);
                </script>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
