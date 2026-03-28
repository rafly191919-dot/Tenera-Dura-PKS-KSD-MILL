PT Kedap Sayaaq Dua - Revisi Final Tanpa Ubah Database

Perubahan utama:
- Grading tidak bisa ketik manual supplier di input transaksi, hanya pilih dari master.
- Staff bisa tambah/edit/hapus supplier.
- Persentase dihitung dari total aktual, tidak wajib total 100.
- Duplicate check pada hari yang sama.
- Grading tidak bisa edit transaksi, staff bisa edit dan hapus.
- Rekap mingguan dan bulanan memakai periode tanggal manual.
- Spreadsheet bisa filter rentang tanggal dan export Excel.
- Laporan WA bisa atur periode manual dan memuat rekap masing-masing supplier serta sopir.
- Ada penanda export berhasil di masing-masing halaman.

Tetap perlu:
1. Firebase Auth Email/Password aktif
2. User grading@dura.local dan staff@dura.local tersedia
3. Firestore rules mengizinkan user login baca/tulis collection transactions
4. Jika deploy ke domain baru, tambahkan domain tersebut ke Authorized Domains Firebase Auth
