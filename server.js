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

let sock;
let qrImageUrl = null;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    // Borramos credenciales viejas para evitar conflictos de dispositivos vinculados
    try {
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }
    } catch (e) {}

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Cambiamos el identificador de navegador para evitar el bloqueo por exceso de dispositivos
        browser: ['Windows', 'Edge', '122.0.2365.92'],
        markOnlineOnConnect: true,
        generateHighQualityQR: true,
        syncFullHistory: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'qr_ready';
            try {
                qrImageUrl = await qrcode.toDataURL(qr, { margin: 4, scale: 8 });
            } catch (err) {
                console.error('Error generando QR:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrImageUrl = null;
            
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrImageUrl = null;
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

app.get('/status', (req, res) => {
    if (qrImageUrl) {
        return res.send(`
            <html>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                    <h2>Escanea este nuevo código QR</h2>
                    <div style="background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
                        <img src="${qrImageUrl}" style="display: block; width: 320px; height: 320px;" />
                    </div>
                    <p style="margin-top: 20px;">Estado: <strong>${connectionStatus}</strong></p>
                    <script>
                        setTimeout(() => { window.location.reload(); }, 35000);
                    </script>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                <h3>Estado: ${connectionStatus}</h3>
                <p>Generando sesión limpia, la página se recargará automáticamente...</p>
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
