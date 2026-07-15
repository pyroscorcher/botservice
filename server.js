const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

app.use(express.json());

// PENTING: Ganti URL ini sesuai dengan URL Laravel lokal Anda
const LARAVEL_API_URL = 'http://127.0.0.1:8000/api/webhook/whatsapp'; 
const SECRET_TOKEN = 'SITABA_PROTOTYPE_SECRET_2026';

async function startBot() {
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal'); // Hore, kita tambahkan ini!
const app = express();
const PORT = 3000;

app.use(express.json());

const LARAVEL_API_URL = 'http://127.0.0.1:8000/api/webhook/whatsapp'; 
const SECRET_TOKEN = 'SITABA_PROTOTYPE_SECRET_2026';

async function startBot() {
        const { state, saveCreds } = await useMultiFileAuthState('auth_store');
        
        const sock = makeWASocket({
            auth: state,
            // Hapus opsi printQRInTerminal: true yang lama karena sudah deprecated
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
            const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!textMessage) return;

            console.log(`Pesan masuk dari [${senderNumber}]: ${textMessage}`);

            if (textMessage.toLowerCase().startsWith('lapor:')) {
                try {
                    const bagian = textMessage.split('|');
                    const deskripsi = bagian[0].replace(/lapor:/i, '').trim();
                    const lokasiRaw = bagian[1] ? bagian[1].replace(/lokasi:/i, '').trim() : 'Lokasi tidak disebutkan';

                    await sock.sendMessage(senderNumber, { 
                        text: 'Terima kasih, laporan Anda telah diterima oleh sistem SITABA.' 
                    });

                    await axios.post(LARAVEL_API_URL, {
                        token: SECRET_TOKEN,
                        nomor_pelapor: senderNumber.split('@')[0],
                        deskripsi: deskripsi,
                        kabupaten: lokasiRaw,
                        status_laporan: 'Baru'
                    });

                    console.log('👉 Laporan berhasil diteruskan ke Laravel!');
                } catch (error) {
                    console.error('❌ Gagal meneruskan laporan ke Laravel:', error.message);
                }
            } else {
                await sock.sendMessage(senderNumber, { 
                    text: 'Selamat datang di Call Center SITABA.\n\nUntuk melaporkan bencana, gunakan format berikut:\n*Lapor:* [Isi Laporan Bencana] | *Lokasi:* [Nama Kabupaten/Kota]' 
                });
            }
        });
    }

    app.listen(PORT, () => {
        console.log(`Server Bot running di port ${PORT}`);
        startBot();
    });
}

// Jalankan Express untuk keperluan monitoring port (opsional)
app.listen(PORT, () => {
    console.log(`Server Bot running di port ${PORT}`);
    startBot();
});