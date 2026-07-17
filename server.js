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

// Sub-types per jenis_bencana. "Kebakaran Gedung dan Pemukiman" has no
// sub-list, so it's intentionally omitted here — the flow skips straight
// to Dampak Bencana for that category (see handleJenisBencana below).
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
// In-memory only — sessions reset if the server restarts. Fine for a
// prototype; for production, swap this Map for a database table or Redis
// so an in-progress report survives a bot restart.
const sessions = new Map();

function newSession() {
    return {
        step: 'awaiting_format', // awaiting_format -> awaiting_jenis_bencana -> awaiting_nama_bencana -> awaiting_dampak_bencana -> awaiting_wilayah_waktu -> done
        data: {},
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

// Keywords that let the reporter skip the optional photo step.
const SKIP_KEYWORDS = ['lewati', 'skip', 'tidak', 'tidak ada', '-'];

const FOTO_PROMPT =
    '(Opsional) Jika Anda memiliki foto kondisi lokasi kejadian, silahkan kirim sebagai gambar sekarang.\n\n' +
    'Jika tidak ada foto, balas dengan mengetik "lewati".';

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

// Maps the normalized (lowercased, no-space) label to the Laporan Masyarakat
// column it fills.
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

/**
 * Parses the pipe-delimited intake message.
 * Returns { pelapor, waktu_kejadian, lokasi, deskripsi, infrastruktur_terdampak, kebutuhan_mendesak }
 * or null if the message doesn't contain all required fields.
 */
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

/** Parses a numeric reply like "3" into a valid 0-based index for the given list, or null. */
function parseChoice(text, list) {
    const n = parseInt(text.trim(), 10);
    if (Number.isNaN(n) || n < 1 || n > list.length) return null;
    return n - 1;
}

/**
 * Parses a reply like "1,3" or "1 3" into multiple items from the given list.
 * Returns the selected items (deduped, in list order) or null if anything is invalid.
 */
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

        // Ignore anything with no usable text UNLESS it's an image arriving
        // during the optional photo step — that's the one case a non-text
        // message is expected and needs to reach the switch below.
        if (!textMessage.trim() && !(hasImage && awaitingFoto)) {
            console.log(`[Diabaikan] Pesan dari ${senderNumber} bukan tipe teks.`);
            return;
        }

        console.log(`[Personal Chat] Dari [${senderNumber}] (${session?.step ?? 'no session'}): ${hasImage ? '[Gambar]' : textMessage}`);

        const reply = (text) => sock.sendMessage(senderNumber, { text });

        // No active session yet -> this message is the trigger. Send the
        // format template and start tracking this sender's progress.
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
                        // No sub-list for this category (e.g. Kebakaran Gedung dan
                        // Pemukiman) — use the category itself as nama_bencana.
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
                    // dampak_bencana is a single varchar column, so multiple
                    // selections are joined into one comma-separated string.
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

                    if (imageMessage) {
                        const buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { reuploadRequest: sock.updateMediaMessage }
                        );

                        const mimetype = imageMessage.mimetype || 'image/jpeg';
                        const extension = mimetype.includes('png') ? 'png' : 'jpg';
                        const filename = `foto_${Date.now()}.${extension}`;

                        await submitLaporan(session.data, senderNumber, { buffer, filename, mimetype });
                        await reply('Terima kasih, laporan beserta foto Anda telah diterima oleh sistem SITABA.');
                        sessions.delete(senderNumber);
                        return;
                    }

                    const isSkip = SKIP_KEYWORDS.includes(textMessage.trim().toLowerCase());
                    if (isSkip) {
                        await submitLaporan(session.data, senderNumber, null);
                        await reply('Terima kasih, laporan Anda telah diterima oleh sistem SITABA.');
                        sessions.delete(senderNumber);
                        return;
                    }

                    await reply('Mohon kirim foto (gambar), atau ketik "lewati" jika tidak ada.\n\n' + FOTO_PROMPT);
                    return;
                }

                default: {
                    // Shouldn't happen, but reset defensively if it does.
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

    async function submitLaporan(data, senderNumber, photo) {
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
            if (photo) {
                // foto is optional — only sent when the reporter actually attaches an image.
                const form = new FormData();
                for (const [key, value] of Object.entries(fields)) {
                    form.append(key, value ?? '');
                }
                form.append('foto', photo.buffer, {
                    filename: photo.filename,
                    contentType: photo.mimetype,
                });

                await axios.post(LARAVEL_API_URL, form, { headers: form.getHeaders() });
            } else {
                await axios.post(LARAVEL_API_URL, fields);
            }

            console.log(`👉 Laporan dari ${senderNumber} berhasil diteruskan ke Laravel!${photo ? ' (dengan foto)' : ''}`);
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