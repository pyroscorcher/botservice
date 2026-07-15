const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

app.use(express.json());

const LARAVEL_API_URL = 'http://127.0.0.1:8000/webhook/whatsapp'; 
const SECRET_TOKEN = 'SITABA_PROTOTYPE_SECRET_2026';

async function startBot() {
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const app = express();
const PORT = 3000;

app.use(express.json());

const LARAVEL_API_URL = 'http://127.0.0.1:8000/webhook/whatsapp'; 
const SECRET_TOKEN = 'SITABA_PROTOTYPE_SECRET_2026';

async function startBot() {
        const { state, saveCreds } = await useMultiFileAuthState('auth_store');
        
        const sock = makeWASocket({
            auth: state,
        });

        sock.ev.on('creds.update', saveCreds);

        // Tangani perubahan koneksi DI SINI untuk memunculkan QR Code
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Cetak QR Code ke terminal jika WhatsApp memintanya
            if (qr) {
                console.log('====== SILAHKAN SCAN QR CODE DI BAWAH INI ======');
                qrcode.generate(qr, { small: true });
                console.log('================================================');
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Koneksi terputus. Mencoba hubungkan ulang: ', shouldReconnect);
                if (shouldReconnect) startBot();
            } else if (connection === 'open') {
                console.log('Bot WhatsApp SITABA Berhasil Terhubung!');
            }
        });

        // Mendengarkan pesan WhatsApp masuk
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const senderNumber = msg.key.remoteJid;
            if (senderNumber.endsWith('@g.us') || senderNumber.endsWith('@broadcast')) {
                console.log(`[Diabaikan] Pesan masuk dari Grup/Broadcast: ${senderNumber}`);
                return; 
            }

// Define main references
    const messageType = Object.keys(msg.message)[0]; // e.g., 'conversation', 'locationMessage', 'imageMessage'
    let textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    let latitude = null;
    let longitude = null;
    let mediaBuffer = null;
    let mediaExtension = '';
    let mediaMimeType = '';

    // 📍 1. HANDLE LOCATION SHARING
    if (messageType === 'locationMessage') {
        const location = msg.message.locationMessage;
        latitude = location.degreesLatitude;
        longitude = location.degreesLongitude;
        textMessage = `[Shared Location] - Coordinates: ${latitude}, ${longitude}`;
        console.log(`📍 Location received from ${senderNumber}: ${latitude}, ${longitude}`);
    }

    // 🖼️ 2. HANDLE IMAGE SHARING
    else if (messageType === 'imageMessage') {
        const imageMessage = msg.message.imageMessage;
        textMessage = imageMessage.caption || '[Image Laporan Bencana]'; // Captions count as the text description
        mediaMimeType = imageMessage.mimetype;
        mediaExtension = '.jpg';
        
        // Decrypt image payload
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        mediaBuffer = buffer;
        console.log(`🖼️ Image received with caption: ${textMessage}`);
    }

    // 🎥 3. HANDLE VIDEO SHARING
    else if (messageType === 'videoMessage') {
        const videoMessage = msg.message.videoMessage;
        textMessage = videoMessage.caption || '[Video Laporan Bencana]';
        mediaMimeType = videoMessage.mimetype;
        mediaExtension = '.mp4';

        // Decrypt video payload
        const stream = await downloadContentFromMessage(videoMessage, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        mediaBuffer = buffer;
        console.log(`🎥 Video received with caption: ${textMessage}`);
    }

        // Only proceed if it is a structured command or rich payload
        if (textMessage.toLowerCase().startsWith('lapor:') || messageType === 'locationMessage' || mediaBuffer) {
            try {
                // Using FormData so we can easily stream binary attachments to Laravel
                const formData = new FormData();
                formData.append('token', SECRET_TOKEN);
                formData.append('nomor_pelapor', senderNumber.split('@')[0]);
                formData.append('deskripsi', textMessage);
                
                if (latitude && longitude) {
                    formData.append('latitude', latitude.toString());
                    formData.append('longitude', longitude.toString());
                }

                if (mediaBuffer) {
                    formData.append('media_file', mediaBuffer, {
                        filename: `report_${Date.now()}${mediaExtension}`,
                        contentType: mediaMimeType
                    });
                }

                // Post Multipart/Form-Data payload directly to Laravel
                await axios.post(LARAVEL_API_URL, formData, {
                    headers: formData.getHeaders()
                });

                await sock.sendMessage(senderNumber, { 
                    text: 'Terima kasih, data laporan (termasuk koordinat/media jika ada) telah disimpan ke Dashboard SITABA.' 
                });
                console.log('👉 Rich report payload successfully pushed to Laravel!');

            } catch (error) {
                console.error('❌ Failed to route rich payload to Laravel:', error.message);
            }
        }
    });
}

    app.listen(PORT, () => {
        console.log(`Server Bot running di port ${PORT}`);
        startBot();
    });
}

app.listen(PORT, () => {
    console.log(`Server Bot running di port ${PORT}`);
    startBot();
});