const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

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

            const senderNumber = msg.key.remoteJid; // Bisa berupa @s.whatsapp.net, @lid, atau @g.us

            // 🔥 FILTER BARU: Blokir jika berupa Grup atau Broadcast
            if (senderNumber.endsWith('@g.us') || senderNumber.endsWith('@broadcast')) {
                console.log(`[Diabaikan] Pesan masuk dari Grup/Broadcast: ${senderNumber}`);
                return; 
            }

            // Jika lolos seleksi di atas, berarti ini 100% Personal Chat (baik tipe @s.whatsapp.net maupun @lid)
            const textMessage = 
                msg.message.conversation || 
                msg.message.extendedTextMessage?.text || 
                msg.message.buttonsResponseMessage?.selectedButtonId || 
                msg.message.templateButtonReplyMessage?.selectedId ||
                '';

            if (!textMessage.trim()) {
                console.log(`[Diabaikan] Pesan dari ${senderNumber} bukan tipe teks.`);
                return;
            }

            console.log(`[Personal Chat Lolos] Dari [${senderNumber}]: ${textMessage}`);

            // LOGIKA OPERASIONAL SITABA
            if (textMessage.toLowerCase().startsWith('lapor:')) {
                try {
                    const bagian = textMessage.split('|');
                    const deskripsi = bagian[0].replace(/lapor:/i, '').trim();
                    const lokasiRaw = bagian[1] ? bagian[1].replace(/lokasi:/i, '').trim() : 'Lokasi tidak disebutkan';

                    // Mengirim balasan teks ke user (Baileys otomatis mendukung pengiriman ke @lid maupun @s.whatsapp.net)
                    await sock.sendMessage(senderNumber, { 
                        text: 'Terima kasih, laporan Anda telah diterima oleh sistem SITABA.' 
                    });

                    // Tembak data ke Laravel API
                    // Catatan: `.split('@')[0]` akan mengambil string ID/Nomor di depan tanda @
                    await axios.post(LARAVEL_API_URL, {
                        token: SECRET_TOKEN,
                        nomor_pelapor: senderNumber.split('@')[0], 
                        deskripsi: deskripsi,
                        kabupaten: lokasiRaw,
                        status_laporan: 'Baru'
                    });

                    console.log('👉 Laporan personal berhasil diteruskan ke Laravel!');
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

app.listen(PORT, () => {
    console.log(`Server Bot running di port ${PORT}`);
    startBot();
});