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
    // Menyimpan sesi login agar tidak perlu scan QR terus-menerus
    const { state, saveCreds } = await useMultiFileAuthState('auth_store');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true // QR Code akan muncul di terminal Anda
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena: ', lastDisconnect.error, ', mencoba hubungkan ulang: ', shouldReconnect);
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

        // FORMAT SIMPEL PROTOTIPE: "Lapor: [Deskripsi Bencana] | Lokasi: [Kabupaten/Kota]"
        // Contoh chat warga: "Lapor: Banjir setinggi dada | Lokasi: Aceh Utara"
        if (textMessage.toLowerCase().startsWith('lapor:')) {
            try {
                // Parsing sederhana menggunakan split string
                const bagian = textMessage.split('|');
                const deskripsi = bagian[0].replace(/lapor:/i, '').trim();
                const lokasiRaw = bagian[1] ? bagian[1].replace(/lokasi:/i, '').trim() : 'Lokasi tidak disebutkan';

                // Balas pesan ke warga terlebih dahulu
                await sock.sendMessage(senderNumber, { 
                    text: 'Terima kasih, laporan Anda telah diterima oleh sistem SITABA dan sedang diteruskan ke petugas.' 
                });

                // Tembak data ke Laravel API
                await axios.post(LARAVEL_API_URL, {
                    token: SECRET_TOKEN,
                    nomor_pelapor: senderNumber.split('@')[0], // Mengambil nomor hp saja tanpa @s.whatsapp.net
                    deskripsi: deskripsi,
                    kabupaten: lokasiRaw, // Di prototipe ini langsung dimasukkan ke kolom teks kabupaten
                    status_laporan: 'Baru'
                });

                console.log('👉 Laporan berhasil diteruskan ke Laravel!');
            } catch (error) {
                console.error('❌ Gagal meneruskan laporan ke Laravel:', error.message);
            }
        } else {
            // Jika format salah, berikan instruksi otomatis kepada warga
            await sock.sendMessage(senderNumber, { 
                text: 'Selamat datang di Call Center SITABA.\n\nUntuk melaporkan bencana, gunakan format berikut:\n*Lapor:* [Isi Laporan Bencana] | *Lokasi:* [Nama Kabupaten/Kota]\n\n_Contoh: Lapor: Tanah longsor menutup jalan | Lokasi: Bogor_' 
            });
        }
    });
}

// Jalankan Express untuk keperluan monitoring port (opsional)
app.listen(PORT, () => {
    console.log(`Server Bot running di port ${PORT}`);
    startBot();
});