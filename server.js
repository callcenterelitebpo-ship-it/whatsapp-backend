// Escuchar mensajes entrantes de WhatsApp y enviarlos a Lovable
sock.ev.on('messages.upsert', async (m) => {
    try {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.key.remoteJid.replace('@s.whatsapp.net', '');
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            console.log(`Mensaje recibido de ${sender}: ${text}`);

            // REENVÍO A LOVABLE/SUPABASE
            // Reemplaza esta URL por la URL del webhook que te genere Lovable/Supabase
            /*
            await fetch('https://TU_PROYECTO.supabase.co/functions/v1/whatsapp-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender, text, raw: msg })
            });
            */
        }
    } catch (err) {
        console.error('Error al procesar mensaje entrante:', err);
    }
});
