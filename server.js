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

        console.log(`Despachando mensaje a ${jid}...`);

        // Validar si el mensaje es un enlace directo a una imagen/flyer para enviarlo como foto multimedia
        const isImageUrl = typeof message === 'string' && 
                           (message.includes('supabase.co/storage') || message.match(/\.(jpeg|jpg|png|webp)(\?.*)?$/i)) && 
                           message.startsWith('http');

        if (isImageUrl) {
            // Extraer el texto plano opcional si viene junto al link o usar solo la imagen
            await sock.sendMessage(jid, { 
                image: { url: message },
                caption: '' 
            });
            console.log(`Imagen enviada correctamente a ${jid}`);
        } else {
            // Envío de texto normal
            await sock.sendMessage(jid, { text: message });
            console.log(`Texto enviado correctamente a ${jid}`);
        }

        res.status(200).json({ status: 'success', sentTo: jid });

    } catch (error) {
        console.error('Error en /send-message:', error);
        res.status(500).json({ error: 'Error al enviar mensaje', details: error.message });
    }
});
