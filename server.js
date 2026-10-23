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
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '22.04.4'],
        markOnlineOnConnect: true,
        generateHighQualityQR: true,
        syncFullHistory: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'qr_ready';
            try {
                qrImageUrl = await qrcode.toDataURL(qr);
                console.log('¡Nuevo código QR generado con éxito!');
            } catch (err) {
                console.error('Error generando imagen QR:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrImageUrl = null;
            
            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
            }

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
                    <h2>Escanea este código QR con tu WhatsApp</h2>
                    <img src="${qrImageUrl}" style="border: 6px solid white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); width: 300px; height: 300px;" />
                    <p>Estado: <strong>${connectionStatus}</strong></p>
                    <script>
                        // Damos 35 segundos estables para que puedas escanear sin que la página se actualice sola
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
                <p>Generando código QR, la página se recargará automáticamente...</p>
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
