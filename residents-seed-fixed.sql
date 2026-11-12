-- Setrika Tracker - Master data penghuni Lorong 6 / kamar 281-290
-- Jalankan setelah schema.sql pada database Cloudflare D1.
-- INSERT OR IGNORE mencegah data ganda jika file dijalankan ulang.

CREATE TABLE IF NOT EXISTS residents (
    resident_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 100),
    room INTEGER NOT NULL CHECK (room BETWEEN 281 AND 290),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (full_name, room)
);

CREATE INDEX IF NOT EXISTS idx_residents_room_name
ON residents (room, full_name);

-- D1 tidak menerima BEGIN TRANSACTION; setiap statement dijalankan tanpa wrapper transaksi.

INSERT OR IGNORE INTO residents (full_name, room) VALUES
    ('Andhika', 281),
    ('Jovian Akira Tama', 281),
    ('Miftahul Hadi', 281),
    ('Arka Bima Putra Regian', 282),
    ('Muhammad Jimmy', 282),
    ('Satryo Bagus Prakoso', 282),
    ('Aidil Adha', 283),
    ('Azmi Sulaiman Qush', 283),
    ('Cahaya Tsaga Kinata', 284),
    ('Muhamad Azmi Rais', 284),
    ('Rohmatullah', 284),
    ('Abdullah Umair', 285),
    ('Aulia Zikrillah', 285),
    ('Prasetyo Aji', 285),
    ('Muhammad Inno Juliyanto', 286),
    ('Riksa Yusril Fikri', 286),
    ('Muhamad Rafiudin', 286),
    ('Achmad Nur Fadillah', 287),
    ('Fakhri Sa''ban', 287),
    ('Hans Eramus Jerusalem Banjarnahor', 287),
    ('Alief Al Hakiem', 288),
    ('Rasya Bagus Indrianta', 288),
    ('Reigha Ariyasatia Nadika', 288),
    ('Ananda Alip', 289),
    ('Ijlal Najihul Amal', 289),
    ('Rafael Hasiholan Manurung', 289),
    ('Juandito Ibrahim Gurning', 290),
    ('Kafa Billahi Syahida', 290),
    ('Mauluda Fajri Ardiansyah', 290);


-- Verifikasi: jumlah penghuni per kamar.
SELECT room, COUNT(*) AS jumlah_penghuni
FROM residents
GROUP BY room
ORDER BY room;

-- Verifikasi: seluruh daftar penghuni.
SELECT resident_id, full_name, room
FROM residents
ORDER BY room, full_name;
