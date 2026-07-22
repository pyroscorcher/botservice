const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const FormData = require('form-data'); // npm install form-data

const app = express();
const PORT = 3000;

app.use(express.json());

const LARAVEL_API_URL = 'http://127.0.0.1:8000/api/webhook/whatsapp';
const SECRET_TOKEN = 'SITABA_PROTOTYPE_SECRET_2026';

// ---------------------------------------------------------------------------
// Reference data — keep these in sync with what the SITABA dashboard expects.
// ---------------------------------------------------------------------------

const JENIS_BENCANA = [
    'Kebakaran Gedung dan Pemukiman',
    'Gagal Teknologi',
    'Epidemi dan Wabah Penyakit',
    'Kekeringan',
    'Tanah Longsor',
    'Gempabumi',
    'Banjir',
    'Konflik Sosial',
    'Cuaca Ekstrim',
    'Erupsi Gunung Api',
    'Gelombang Pasang dan Abrasi',
    'Kebakaran Hutan dan Lahan',
    'Tsunami',
];

const NAMA_BENCANA_MAP = {
    'Gagal Teknologi': ['Kegagalan Industri', 'Kecelakaan Industri'],
    'Epidemi dan Wabah Penyakit': ['Epidemi', 'Wabah Penyakit'],
    'Kekeringan': ['Kekeringan Meteorologis', 'Kekeringan Hidrologis', 'Kekeringan Pertanian'],
    'Tanah Longsor': ['Longsor', 'Gerakan Tanah'],
    'Gempabumi': ['Gempa Tektonik', 'Gempa Vulkanik', 'Gempabumi Runtuhan'],
    'Banjir': ['Banjir dan Tanah Longsor', 'Banjir Genangan', 'Banjir Bandang', 'Banjir Drainase & Selokan', 'Banjir Waduk', 'Tanggul Jebol'],
    'Konflik Sosial': ['Teror', 'Kerusakan Sosial', 'Konflik Sosial'],
    'Cuaca Ekstrim': ['Angin Topan', 'Hujan Es', 'Siklon Tropis', 'Puting Beliung', 'Angin Kencang', 'Suhu Udara Ekstrem'],
    'Erupsi Gunung Api': ['Banjir Lahar', 'Hujan Abu Vulkanik', 'Awan Panas Aliran Piroklastik Guguran', 'Awan Panas Aliran Piroklastik', 'Gas Vulkanik Beracun'],
    'Gelombang Pasang dan Abrasi': ['Gelombang Pasang', 'Abrasi'],
    'Kebakaran Hutan dan Lahan': ['Kebakaran Hutan', 'Kebakaran Lahan', 'Kebakaran Lahan Gambut'],
    'Tsunami': ['Mikrotsunami', 'Tsunami Sesimogenik', 'Tsunami Nonseismik', 'Tsunami Lokal', 'Tsunami Regional', 'Tsunami Jarak', 'Tsunami Meteorologi'],
};

const DAMPAK_BENCANA = ['Kerusakan SDA', 'Kerusakan Pemukiman', 'Kerusakan Jalanan dan Jembatan'];

const WILAYAH_WAKTU = ['WIB', 'WITA', 'WIT'];

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------
const sessions = new Map();

function newSession() {
    return {
        step: 'awaiting_format',
        data: {
            fotos: [] // Menyiapkan array kosong untuk menampung multi-foto
        },
    };
}

function numberedList(items) {
    return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

const FORMAT_TEMPLATE =
    'Selamat datang di Call Center SITABA.\n\n' +
    'Untuk melaporkan bencana, silahkan balas pesan ini dengan format berikut ' +
    '(pastikan setiap bagian dipisahkan tanda "|"):\n\n' +
    'Nama Pelapor : [Isi Nama Pelapor] | ' +
    'Nomor Telepon : [Nomor telepon yang bisa dihubungi] | ' +
    'Waktu Kejadian : [Waktu dan tanggal kejadian] | ' +
    'Lokasi Kejadian : [Alamat detail kejadian] | ' +
    'Deskripsi : [Deskripsi kejadian] | ' +
    'Infrastruktur Terdampak : [Infrastruktur apa saja yang terdampak] | ' +
    'Kebutuhan Mendesak : [Kebutuhan mendesak di lokasi bencana, isi (-) jika tidak ada]';

function jenisBencanaPrompt() {
    return `Pilih Jenis Bencana (balas dengan nomor):\n\n${numberedList(JENIS_BENCANA)}`;
}

function namaBencanaPrompt(jenisBencana) {
    const options = NAMA_BENCANA_MAP[jenisBencana];
    return `Pilih Nama Bencana untuk "${jenisBencana}" (balas dengan nomor):\n\n${numberedList(options)}`;
}

function dampakBencanaPrompt() {
    return `Pilih Dampak Bencana — bisa lebih dari satu, pisahkan dengan koma (contoh: 1,3):\n\n${numberedList(DAMPAK_BENCANA)}`;
}

function wilayahWaktuPrompt() {
    return `Pilih Wilayah Waktu kejadian (balas dengan nomor):\n\n${numberedList(WILAYAH_WAKTU)}`;
}

// Kata kunci untuk mengakhiri tahap pengiriman foto
const SKIP_KEYWORDS = ['lewati', 'skip', 'tidak', 'tidak ada', '-', 'selesai', 'cukup', 'sudah'];

const FOTO_PROMPT =
    '(Opsional) Jika Anda memiliki foto kondisi lokasi kejadian, silahkan kirim sebagai gambar.\n' +
    '*(Anda bisa mengirim lebih dari 1 foto secara bergantian)*.\n\n' +
    'Jika sudah selesai mengirim foto, atau tidak ada foto, ketik: *"selesai"*.';

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const LABEL_TO_FIELD = {
    'namapelapor': 'pelapor',
    'nomortelepon': 'telepon',
    'waktukejadian': 'waktu_kejadian',
    'lokasikejadian': 'lokasi',
    'deskripsi': 'deskripsi',
    'infrastrukturterdampak': 'infrastruktur_terdampak',
    'kebutuhanmendesak': 'kebutuhan_mendesak',
};

const REQUIRED_LABELS = Object.keys(LABEL_TO_FIELD);

function parseFormatMessage(text) {
    const segments = text.split('|').map((s) => s.trim()).filter(Boolean);
    const result = {};

    for (const segment of segments) {
        const separatorIndex = segment.indexOf(':');
        if (separatorIndex === -1) continue;

        const rawLabel = segment.slice(0, separatorIndex).trim();
        const value = segment.slice(separatorIndex + 1).trim();

        const normalizedLabel = rawLabel.toLowerCase().replace(/\s+/g, '');
        const field = LABEL_TO_FIELD[normalizedLabel];

        if (field && value) {
            result[field] = value;
        }
    }

    const hasAllFields = REQUIRED_LABELS.every((label) => result[LABEL_TO_FIELD[label]]);
    return hasAllFields ? result : null;
}

function parseChoice(text, list) {
    const n = parseInt(text.trim(), 10);
    if (Number.isNaN(n) || n < 1 || n > list.length) return null;
    return n - 1;
}

function parseMultipleChoices(text, list) {
    const parts = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const indices = new Set();
    for (const part of parts) {
        const n = parseInt(part, 10);
        if (Number.isNaN(n) || n < 1 || n > list.length) return null;
        indices.add(n - 1);
    }

    return [...indices].sort((a, b) => a - b).map((i) => list[i]);
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_store');

    const sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

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

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;

        if (senderNumber.endsWith('@g.us') || senderNumber.endsWith('@broadcast')) {
            console.log(`[Diabaikan] Pesan masuk dari Grup/Broadcast: ${senderNumber}`);
            return;
        }

        const textMessage =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||
            msg.message.templateButtonReplyMessage?.selectedId ||
            msg.message.imageMessage?.caption ||
            '';

        const hasImage = Boolean(msg.message.imageMessage);
        const session = sessions.get(senderNumber);
        const awaitingFoto = session?.step === 'awaiting_foto';

        if (!textMessage.trim() && !(hasImage && awaitingFoto)) {
            console.log(`[Diabaikan] Pesan dari ${senderNumber} bukan tipe teks.`);
            return;
        }

        console.log(`[Personal Chat] Dari [${senderNumber}] (${session?.step ?? 'no session'}): ${hasImage ? '[Gambar]' : textMessage}`);

        const reply = (text) => sock.sendMessage(senderNumber, { text });

        if (!session) {
            sessions.set(senderNumber, newSession());
            await reply(FORMAT_TEMPLATE);
            return;
        }

        try {
            switch (session.step) {
                case 'awaiting_format': {
                    const parsed = parseFormatMessage(textMessage);
                    if (!parsed) {
                        await reply(
                            'Format belum sesuai. Mohon kirim ulang sesuai format berikut:\n\n' + FORMAT_TEMPLATE
                        );
                        return;
                    }
                    Object.assign(session.data, parsed);
                    session.step = 'awaiting_jenis_bencana';
                    await reply(jenisBencanaPrompt());
                    return;
                }

                case 'awaiting_jenis_bencana': {
                    const index = parseChoice(textMessage, JENIS_BENCANA);
                    if (index === null) {
                        await reply('Nomor tidak valid. ' + jenisBencanaPrompt());
                        return;
                    }
                    const jenisBencana = JENIS_BENCANA[index];
                    session.data.jenis_bencana = jenisBencana;

                    if (NAMA_BENCANA_MAP[jenisBencana]) {
                        session.step = 'awaiting_nama_bencana';
                        await reply(namaBencanaPrompt(jenisBencana));
                    } else {
                        session.data.nama_bencana = jenisBencana;
                        session.step = 'awaiting_dampak_bencana';
                        await reply(dampakBencanaPrompt());
                    }
                    return;
                }

                case 'awaiting_nama_bencana': {
                    const options = NAMA_BENCANA_MAP[session.data.jenis_bencana];
                    const index = parseChoice(textMessage, options);
                    if (index === null) {
                        await reply('Nomor tidak valid. ' + namaBencanaPrompt(session.data.jenis_bencana));
                        return;
                    }
                    session.data.nama_bencana = options[index];
                    session.step = 'awaiting_dampak_bencana';
                    await reply(dampakBencanaPrompt());
                    return;
                }

                case 'awaiting_dampak_bencana': {
                    const selected = parseMultipleChoices(textMessage, DAMPAK_BENCANA);
                    if (!selected) {
                        await reply('Pilihan tidak valid. ' + dampakBencanaPrompt());
                        return;
                    }
                    session.data.dampak_bencana = selected.join(', ');
                    session.step = 'awaiting_wilayah_waktu';
                    await reply(wilayahWaktuPrompt());
                    return;
                }

                case 'awaiting_wilayah_waktu': {
                    const index = parseChoice(textMessage, WILAYAH_WAKTU);
                    if (index === null) {
                        await reply('Nomor tidak valid. ' + wilayahWaktuPrompt());
                        return;
                    }
                    session.data.wilayah_waktu = WILAYAH_WAKTU[index];
                    session.step = 'awaiting_foto';
                    await reply(FOTO_PROMPT);
                    return;
                }

                case 'awaiting_foto': {
                    const imageMessage = msg.message.imageMessage;

                    // 1. Jika pesan berupa gambar, simpan ke array, lalu tahan (jangan di-submit)
                    if (imageMessage) {
                        const buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { reuploadRequest: sock.updateMediaMessage }
                        );

                        const mimetype = imageMessage.mimetype || 'image/jpeg';
                        const extension = mimetype.includes('png') ? 'png' : 'jpg';
                        // Berikan nama unik untuk setiap foto
                        const filename = `foto_${Date.now()}_${session.data.fotos.length + 1}.${extension}`;

                        // Simpan ke array state
                        session.data.fotos.push({ buffer, filename, mimetype });

                        await reply(`✅ Foto ke-${session.data.fotos.length} diterima.\n\nSilahkan kirim foto lainnya jika ada, atau balas dengan mengetik *"selesai"* untuk memproses laporan.`);
                        return;
                    }

                    // 2. Jika pesan berupa teks "selesai" / "skip"
                    const isSkip = SKIP_KEYWORDS.includes(textMessage.trim().toLowerCase());
                    if (isSkip) {
                        // Submit seluruh data beserta kumpulan foto yang mungkin sudah tersimpan di array
                        await submitLaporan(session.data, senderNumber, session.data.fotos);
                        await reply('Terima kasih, laporan beserta foto Anda telah berhasil dikirim ke sistem SITABA.');
                        sessions.delete(senderNumber);
                        return;
                    }

                    // 3. Jika pesan bukan gambar & bukan kata kunci pengakhir
                    await reply('Mohon kirim foto (gambar), atau ketik *"selesai"* jika sudah selesai / tidak ada foto.\n\n' + FOTO_PROMPT);
                    return;
                }

                default: {
                    sessions.delete(senderNumber);
                    await reply(FORMAT_TEMPLATE);
                    return;
                }
            }
        } catch (error) {
            console.error('❌ Terjadi kesalahan saat memproses sesi:', error.message);
            await reply('Maaf, terjadi kesalahan pada sistem. Silahkan mulai kembali dengan mengirim pesan apapun.');
            sessions.delete(senderNumber);
        }
    });

    async function submitLaporan(data, senderNumber, fotos) {
        const fields = {
            token: SECRET_TOKEN,
            pelapor: data.pelapor,
            telepon: data.telepon,
            jenis_bencana: data.jenis_bencana,
            nama_bencana: data.nama_bencana,
            dampak_bencana: data.dampak_bencana,
            waktu_kejadian: data.waktu_kejadian,
            wilayah_waktu: data.wilayah_waktu,
            lokasi: data.lokasi,
            deskripsi: data.deskripsi,
            infrastruktur_terdampak: data.infrastruktur_terdampak,
            kebutuhan_mendesak: data.kebutuhan_mendesak,
            status: 'Baru',
        };

        try {
            if (fotos && fotos.length > 0) {
                const form = new FormData();
                
                // Masukkan fields teks
                for (const [key, value] of Object.entries(fields)) {
                    form.append(key, value ?? '');
                }

                // Looping array untuk memasukkan banyak foto
                // Perhatikan key menggunakan 'fotos[]' agar dikenali sebagai array oleh Laravel Request
                for (const photo of fotos) {
                    form.append('fotos[]', photo.buffer, {
                        filename: photo.filename,
                        contentType: photo.mimetype,
                    });
                }

                await axios.post(LARAVEL_API_URL, form, { headers: form.getHeaders() });
            } else {
                // Submit tanpa foto
                await axios.post(LARAVEL_API_URL, fields);
            }

            console.log(`👉 Laporan dari ${senderNumber} berhasil diteruskan ke Laravel! (Jumlah foto: ${fotos.length})`);
        } catch (error) {
            console.error('❌ Gagal meneruskan laporan ke Laravel:', error.message);
            throw error;
        }
    }
}

app.listen(PORT, () => {
    console.log(`Server Bot running di port ${PORT}`);
    startBot();
});