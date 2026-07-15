# Audit Menyeluruh - REVDMAIL (Temp Mail Service)

Tanggal audit: 15 Juli 2026
Lingkup: seluruh source code aplikasi (backend Node.js/Express, frontend Vanilla JS, dependency, konfigurasi).
Metode: pembacaan langsung setiap file kode, pengecekan dependency lewat `npm audit` dan `npm outdated`, penelusuran alur bisnis end to end.

Catatan penting sebelum masuk ke temuan: aplikasi ini pada dasarnya adalah satu mailbox IMAP nyata (biasanya Gmail) yang menerima semua alamat sementara lewat catch all / email routing di level DNS, lalu aplikasi hanya menyaring pesan berdasarkan header To/Delivered-To/X-Original-To/Cc. Artinya tidak ada isolasi data per pengguna di level server. Ini memengaruhi banyak temuan keamanan di bawah.

## 1. Struktur Project

Struktur folder sudah cukup rapi dan mengikuti pola MVC ringan: `routes -> controller -> service -> utils`. Pemisahan frontend (`public/`) dan backend (`src/`, `server.js`) jelas.

Temuan:

- File: `src/services/cloudflareService.js.bak`
  Prioritas: Medium
  Masalah: file backend lama untuk otomatisasi Cloudflare Email Routing (create/list/delete rule) masih tersimpan di repo dengan ekstensi `.bak`, tidak dipanggil di mana pun (`grep` untuk `cloudflareService` tidak menemukan pemakaian di `apiController.js` atau `server.js`).
  Penyebab: sisa refactor, alur pembuatan email sekarang tidak lagi otomatis membuat rule forwarding, hanya mengembalikan string email.
  Dampak: membingungkan kontributor baru (terlihat seperti fitur aktif), menyimpan pola integrasi Cloudflare API yang sudah tidak sinkron dengan alur nyata, menambah luas serangan jika suatu saat file di-require kembali tanpa review.
  Solusi: hapus file ini dari repo (gunakan riwayat git bila perlu dikembalikan), atau jika fitur otomatisasi Cloudflare memang direncanakan aktif kembali, pindahkan ke `src/services/cloudflareService.js` dan sambungkan ke rute yang jelas.
  Best practice: jangan menyimpan file `.bak` di version control, gunakan git history sebagai backup.

- File: `public/index2.html`, `public/index.html.bak`, `public/css/style.css`, `public/css/new.css`
  Prioritas: Medium
  Masalah: `server.js` hanya menyajikan `public/index.html` (route catch all `res.sendFile(... 'index.html')`). File `index2.html` dan `index.html.bak` adalah versi UI lama yang memuat `css/style.css`, sedangkan `index.html` yang aktif sekarang memakai Tailwind CDN inline dan tidak me-load `style.css` maupun `new.css` sama sekali (dikonfirmasi lewat pencarian string `new.css` dan `style.css` di `index.html`, tidak ditemukan).
  Penyebab: migrasi desain dari CSS custom ke Tailwind CDN, file lama tidak dibersihkan.
  Dampak: 740 baris CSS mati tidak terpakai, dua file HTML lengkap (index2.html, index.html.bak) yang bisa diakses langsung lewat URL statis (`/index2.html`, `/index.html.bak`) karena `express.static('public')` menyajikan semua file di folder tersebut secara default, termasuk yang seharusnya tidak dipublikasikan.
  Dampak keamanan tambahan: `index.html.bak` bisa membocorkan struktur/versi lama aplikasi ke publik lewat URL langsung.
  Solusi: hapus file yang tidak dipakai, atau jika ingin disimpan sebagai referensi, pindahkan ke luar folder `public/` (misalnya `docs/legacy/`) supaya tidak ikut disajikan oleh `express.static`.
  Contoh perbaikan singkat di `server.js` bila ingin tetap menyimpan file cadangan di dalam repo tapi tidak boleh diakses publik:
  ```js
  app.use(express.static('public', {
      extensions: false,
      setHeaders: (res, filePath) => {
          if (filePath.endsWith('.bak')) res.status(404).end();
      }
  }));
  ```
  Namun solusi paling bersih tetap menghapus file tersebut dari `public/`.

- File: `.gitignore`
  Prioritas: Medium
  Masalah: file `.gitignore` tidak ada sama sekali di root project.
  Penyebab: tidak dibuat saat inisialisasi project.
  Dampak: risiko `.env`, `node_modules/`, atau file lokal lain ikut ter-commit secara tidak sengaja di masa depan. Saat ini `.env` belum dibuat (secrets memakai Replit Secrets), tapi risiko tetap ada begitu ada kontributor yang membuat file `.env` lokal untuk testing.
  Solusi: tambahkan `.gitignore` minimal berikut.
  ```
  node_modules/
  .env
  .env.*
  *.bak
  .DS_Store
  ```
  Best practice: `.gitignore` wajib ada di setiap project Node.js sejak commit pertama.

Kesimpulan struktur: modularisasi sudah baik, tidak ada duplikasi logika bisnis yang signifikan antar file, tapi kebersihan repo (file mati, file backup) perlu dirapikan.

## 2. Code Quality

- File: `src/controllers/apiController.js`, fungsi `listEmails` (baris 42-44)
  Prioritas: Low
  Masalah: endpoint selalu mengembalikan `{ generated_emails: [] }` tanpa logika apa pun, dan tidak dipanggil oleh frontend (`public/js/script.js` tidak pernah fetch ke `/api/emails`).
  Penyebab: kemungkinan sisa dari rencana fitur multi alamat yang belum/tidak dilanjutkan.
  Dampak: dead code, endpoint publik yang tidak berguna tapi tetap menghabiskan permukaan API dan bisa membingungkan konsumen API pihak ketiga.
  Solusi: hapus endpoint dan fungsi ini jika benar tidak dipakai, atau implementasikan sungguhan jika rencana multi alamat aktif. Karena arsitektur saat ini stateless (tidak ada database), fitur "daftar semua email yang pernah dibuat" memang tidak bisa diimplementasikan tanpa penyimpanan permanen.

- File: `src/controllers/apiController.js`, fungsi `deleteEmail` (baris 46-60)
  Prioritas: Medium
  Masalah: endpoint selalu membalas `{ message: "Successfully removed ..." }` padahal tidak ada operasi penghapusan nyata yang terjadi (tidak ada database/store untuk alamat email, IMAP mailbox juga tidak disentuh).
  Penyebab: tidak ada lapisan persistensi, alamat email hanyalah string yang dibuat on the fly.
  Dampak: API mengklaim sukses melakukan aksi yang sebenarnya tidak terjadi, ini menyesatkan konsumen API dan melanggar prinsip "jangan diam diam gagal" karena responsnya justru diam diam berbohong sukses.
  Solusi: ubah response menjadi jujur soal apa yang sebenarnya dilakukan, misalnya:
  ```js
  return res.json({
      message: `Address ${emailToRemove} cleared from this session. Mail already delivered to the shared mailbox is not deleted.`
  });
  ```
  Atau, jika ingin benar benar menghapus pesan terkait, tambahkan pemanggilan IMAP `EXPUNGE`/`STORE Deleted` pada pesan yang match, tapi ini berisiko menghapus pesan yang mungkin relevan untuk alamat lain jika mailbox dipakai bersama.

- File: `src/services/imapService.js`
  Prioritas: Low
  Masalah: penggunaan variabel modul level (`activeConnection`, `connectionPromise`, `cachedFolders`, dll) sebagai state global sudah didokumentasikan dengan komentar yang jelas, penanganan reconnect dan keepalive cukup rapi. Tidak ditemukan dead code atau magic number yang tidak dijelaskan (KEEPALIVE_INTERVAL_MS, RECONNECT_DELAY_MS sudah diberi nama dan komentar).
  Catatan positif: pola singleton connection dengan promise lock untuk mencegah race saat connect adalah praktik yang baik.
  Namun ada isu konkurensi terkait fungsi `fetchFromFolder`, dibahas di bagian Keamanan/Performa di bawah karena dampaknya lebih ke integritas data lintas pengguna.

- File: seluruh backend
  Prioritas: Low
  Masalah: logging memakai `console.log`/`console.warn`/`console.error` polos tanpa level terstruktur atau request id, sebagian diberi emoji (contoh baris `console.log('🔌 Connecting to IMAP…')`).
  Dampak: sulit memfilter log berdasarkan severity di lingkungan produksi, tidak ada correlation id untuk melacak satu request tertentu saat debugging race condition IMAP.
  Solusi: pertimbangkan logger sederhana seperti `pino` dengan level (`info`, `warn`, `error`) dan opsional request id middleware. Untuk project sekecil ini, ini prioritas rendah dan tidak mendesak.

Kesimpulan code quality: penamaan variabel dan fungsi jelas dan konsisten (camelCase, deskriptif), async/await dipakai konsisten dan benar (tidak ada unhandled promise yang terlihat), error handling di level try/catch ada di semua titik I/O. Isu utama bukan pada gaya kode, melainkan pada kejujuran response API dan file mati.

## 3. Alur Bisnis Temp Mail

- Pembuatan email (`POST /api/create`): domain divalidasi terhadap `AVAILABLE_DOMAINS`, username custom divalidasi dengan regex `^[a-zA-Z0-9._-]+$` (baik, mencegah karakter aneh masuk ke alamat email). Tidak ada pengecekan panjang minimum/maksimum username, secara teori bisa mengirim username sangat panjang.
  Prioritas: Low
  Solusi: tambahkan batas panjang, contoh:
  ```js
  if (customUser.length > 64) {
      return res.status(400).json({ error: "Username too long (max 64 characters)." });
  }
  ```

- Masa aktif email dan penghapusan otomatis: tidak diimplementasikan sama sekali. Field `expires_at` di response `createEmail` selalu `null` (baris 39 `apiController.js`). Tidak ada job/cron yang membersihkan apa pun karena memang tidak ada state yang disimpan di server (state hanya ada di `localStorage` browser).
  Prioritas: Medium (fungsional, bukan keamanan)
  Dampak: dokumentasi/harapan pengguna tentang "temporary" tidak match dengan implementasi, alamat email pada dasarnya permanen selama mailbox IMAP di baliknya tetap aktif dan domain masih mengarah ke sana. Siapa pun yang tahu alamatnya bisa membaca isinya kapan saja tanpa batas waktu.
  Solusi: jika masa aktif adalah fitur yang dijanjikan ke pengguna, perlu lapisan penyimpanan (misal Replit DB atau tabel sederhana) yang mencatat `created_at` per alamat, lalu endpoint `getMessages` menolak alamat yang sudah melewati TTL. Jika masa aktif bukan janji produk, sebaiknya hapus field `expires_at` dari response agar tidak menyesatkan integrator API.

- Pengambilan inbox dan sinkronisasi (`GET /api/messages`): mencari pesan lewat kombinasi header `TO`, `DELIVERED-TO`, `X-Original-To`, `CC` di folder All Mail dan Spam, dengan deduplikasi berdasarkan `Message-ID`. Pendekatan ini solid untuk skenario catch all forwarding.
  Retry mechanism: ada retry sekali (2 detik) khusus saat koneksi baru dan hasil kosong (baris 271-278 `imapService.js`), cukup untuk mengatasi delay indexing Gmail setelah reconnect.
  Refresh inbox: dilakukan lewat polling frontend setiap 15 detik (`public/js/script.js` baris 486), bukan real time (bukan WebSocket/SSE/IMAP IDLE push).
  Prioritas: Low (peningkatan, bukan bug)
  Solusi: jika ingin benar benar real time, IMAP mendukung mode `IDLE` yang bisa memicu push saat ada pesan baru tanpa polling. Untuk skala kecil, polling 15 detik saat ini sudah wajar dan tidak perlu diubah kecuali traffic naik signifikan.

- Multi session dan multi user: tidak ada konsep sesi/otentikasi sama sekali. "Kepemilikan" alamat email hanya ditentukan oleh siapa yang tahu string alamatnya (disimpan di `localStorage` browser masing masing). Ini dibahas lebih detail di bagian Keamanan karena berdampak langsung pada kerahasiaan data.

- Spam handling: folder spam ikut diperiksa dan digabung ke hasil (baris 264-269 `imapService.js`), tidak ada mekanisme untuk menandai pesan sebagai spam dari sisi aplikasi, hanya membaca folder spam bawaan provider. Ini sudah wajar untuk aplikasi temp mail sederhana.

- Attachment: tidak ditemukan penanganan attachment sama sekali. `mailparser` sebenarnya mem-parse attachment (`parsed.attachments`), tetapi hasil parsing di `fetchImapMessages` hanya mengambil `subject`, `from`, `date`, `text`, `html`, attachment dibuang begitu saja.
  Prioritas: Medium (gap fungsional, bukan bug, tergantung apakah ini fitur yang dijanjikan)
  Dampak: jika pengirim melampirkan file (misalnya kode OTP dalam PDF, invoice, dsb), pengguna tidak bisa mengaksesnya lewat UI ini.
  Solusi bila attachment ingin didukung:
  ```js
  const attachments = (parsed.attachments || []).map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size
  }));
  ```
  lalu sediakan endpoint terpisah untuk mengunduh isi attachment per `Message-ID` + nama file, jangan mengirim seluruh isi attachment (base64) di response `getMessages` karena bisa membuat payload sangat besar.

Kesimpulan alur bisnis: logika pengambilan pesan sudah matang dan robust terhadap gangguan koneksi, tetapi beberapa "janji" konsep temp mail (masa aktif, kepemilikan privat, attachment) belum benar benar terpenuhi di level implementasi.

## 4. Audit API

- File: `src/routes/apiRoutes.js` dan `src/controllers/apiController.js`
  Prioritas: High
  Masalah: endpoint `GET /api/debug/emails` (baris 10 `apiRoutes.js`, fungsi `debugEmails` baris 113-117 `apiController.js`) mengembalikan isi mentah folder All Mail (subjek, from, to, delivered-to, x-original-to, cc) dari **seluruh** pesan terbaru di mailbox bersama, tanpa parameter filter alamat, tanpa otentikasi apa pun.
  Penyebab: dibuat sebagai alat debug untuk melihat bagaimana header forwarding terlihat di Gmail (sesuai komentar di `imapService.js` baris 332-334), tapi tetap terpasang aktif di rute publik produksi.
  Dampak: siapa pun yang mengakses `https://domain-anda/api/debug/emails?limit=20` bisa melihat potongan informasi (subjek, alamat pengirim, alamat tujuan asli) dari email pengguna lain yang sedang menggunakan layanan ini, termasuk kemungkinan mengetahui alamat asli tujuan sebelum forwarding. Ini adalah kebocoran data lintas pengguna.
  Solusi: hapus endpoint ini dari build produksi, atau minimal lindungi dengan pengecekan environment dan token rahasia:
  ```js
  router.get('/debug/emails', (req, res, next) => {
      if (process.env.NODE_ENV === 'production') {
          return res.status(404).end();
      }
      next();
  }, apiController.debugEmails);
  ```
  Best practice: endpoint debug/introspeksi tidak boleh pernah aktif di production tanpa proteksi auth terpisah (misalnya token admin yang dicek lewat header, bukan query string).

- File: `src/controllers/apiController.js`, fungsi `getMessages` (baris 62-94)
  Prioritas: Critical
  Masalah: tidak ada mekanisme otentikasi/otorisasi kepemilikan alamat email. Siapa pun yang mengetahui atau menebak sebuah alamat pada domain yang diizinkan bisa langsung membaca seluruh inbox alamat tersebut lewat `GET /api/messages?email=<alamat>`.
  Penyebab: arsitektur "shared mailbox catch all" tanpa lapisan sesi/kepemilikan di atasnya.
  Dampak: kerahasiaan email pengguna lain bergantung sepenuhnya pada kerahasiaan string alamat, bukan pada kontrol akses nyata. Digabung dengan pola penamaan yang bisa ditebak (dibahas di bagian Keamanan poin 5), risiko pembacaan inbox orang lain menjadi nyata, bukan cuma teoretis.
  Solusi jangka pendek (tanpa mengubah alur bisnis inti): buat alamat lebih sulit ditebak (tambah entropi acak, bukan sekadar nama + angka 0-999), dan terapkan rate limit ketat per IP pada endpoint ini untuk mempersulit enumerasi brute force.
  Solusi jangka menengah: ikat kepemilikan alamat ke sebuah token rahasia yang dibuat bersamaan saat `POST /api/create` (disimpan di `localStorage`, dikirim sebagai header `X-Access-Token` saat memanggil `GET /api/messages`), sehingga menebak alamat saja tidak cukup untuk membaca isi inbox.
  Ini adalah keputusan produk (apakah temp mail ini memang dirancang "siapa tahu alamat, bisa baca", seperti kebanyakan layanan temp mail publik) sehingga saya tandai sebagai temuan, bukan langsung saya ubah, karena mengubahnya berarti mengubah alur bisnis inti.

- Konsistensi REST: metode HTTP dipakai cukup konsisten (`POST /create`, `GET /messages`, `DELETE /delete`, `GET /domains`), tapi ada inkonsistensi kecil: `deleteEmail` menerima parameter lewat query string (`?email=`) bukan lewat path (`/delete/:email`) atau body, tidak REST-idiomatic tapi tidak salah secara fungsional.
  Prioritas: Low

- Status code: sudah cukup tepat (400 untuk input tidak valid, 403 untuk domain tidak diizinkan, 500 untuk error internal). Tidak ditemukan penyalahgunaan status code.

- Rate limiting, timeout, retry di level HTTP: tidak ada rate limiting sama sekali di semua endpoint (tidak ada `express-rate-limit` atau middleware sejenis di `package.json`/`server.js`). Timeout di level IMAP sudah diatur (`authTimeout`, `connTimeout` 15 detik di `imapService.js`), tapi tidak ada timeout di level HTTP request Express itu sendiri.
  Prioritas: High
  Dampak: endpoint `POST /api/create`, `GET /api/messages`, `GET /api/gmail-generator` bisa dipanggil tanpa batas oleh satu klien, membuka celah DoS sederhana (menghabiskan koneksi IMAP, CPU parsing email, atau memory dari daftar varian Gmail).
  Solusi:
  ```js
  const rateLimit = require('express-rate-limit');

  const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false
  });

  app.use('/api', apiLimiter);
  ```
  Perlu tambah dependency `express-rate-limit` ke `package.json`.

- Pagination: tidak relevan untuk endpoint saat ini karena jumlah pesan per alamat dibatasi `limit` (default 20), sudah memadai untuk skala aplikasi ini.

Kesimpulan API: struktur REST cukup rapi, tapi API ini sepenuhnya publik dan tanpa proteksi laju permintaan, dan satu endpoint debug membocorkan data lintas pengguna.

## 5. Audit Keamanan

Berikut daftar temuan keamanan dengan tingkat risiko.

1. Endpoint debug membocorkan data lintas pengguna
   File: `src/controllers/apiController.js` (fungsi `debugEmails`), `src/routes/apiRoutes.js` baris 10
   Risiko: Critical
   Lihat detail di bagian Audit API di atas.

2. Tidak ada otentikasi/otorisasi kepemilikan alamat email (IDOR secara konsep)
   File: `src/controllers/apiController.js` (fungsi `getMessages`)
   Risiko: Critical
   Lihat detail di bagian Audit API di atas.

3. Pembuatan nama alamat yang bisa ditebak
   File: `src/utils/nameGenerator.js` baris 26-37
   Risiko: High
   Masalah: prefix alamat dihasilkan dari daftar nama terbatas (`username/pria.txt`, `username/perempuan.txt`) ditambah angka acak 0-999. Total kombinasi per nama hanya 1000, dan daftar nama itu sendiri terbatas serta bisa dibaca langsung dari repo (`username/pria.txt`, `username/perempuan.txt`) karena disajikan sebagai file teks biasa, bukan rahasia, tapi kombinasinya publik dan bisa dienumerasi.
   Penyebab: fungsi `Math.random()` dipakai untuk memilih nama dan angka, bukan generator kriptografis, dan ruang kombinasi sengaja kecil supaya nama terlihat manusiawi.
   Dampak: penyerang bisa melakukan brute force alamat (nama umum + 3 digit angka) untuk menemukan alamat aktif milik pengguna lain, lalu memanfaatkan temuan poin 2 di atas untuk membaca inbox mereka.
   Solusi: tambahkan komponen acak tambahan yang tidak ditebak, misalnya menambahkan hash pendek acak:
   ```js
   const crypto = require('crypto');

   function generateRandomPrefix() {
       const allNames = [...maleNames, ...femaleNames];
       const base = allNames.length > 0
           ? allNames[Math.floor(Math.random() * allNames.length)].replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
           : 'user';
       const randomSuffix = crypto.randomBytes(3).toString('hex'); // 16.7 juta kombinasi
       return `${base}${randomSuffix}`;
   }
   ```
   Ini tetap menjaga alamat terlihat manusiawi (nama + suffix) tapi menaikkan entropi jauh lebih besar dari 1000 kombinasi.

4. Verifikasi sertifikat TLS IMAP dinonaktifkan
   File: `src/services/imapService.js` baris 86 (`tlsOptions: { rejectUnauthorized: false }`)
   Risiko: High
   Masalah: koneksi ke server IMAP tidak memverifikasi validitas sertifikat TLS, membuka kemungkinan man in the middle terhadap kredensial IMAP (`IMAP_USER`/`IMAP_PASSWORD`) dan seluruh isi email yang lewat.
   Penyebab: kemungkinan ditambahkan untuk mengatasi error sertifikat self signed pada provider IMAP tertentu saat development.
   Dampak: jika jaringan antara server aplikasi dan server IMAP disadap atau di-spoof, kredensial mailbox dan isi email bisa dicuri tanpa terdeteksi.
   Solusi: aktifkan verifikasi sertifikat di production, hanya nonaktifkan secara eksplisit untuk host tertentu yang memang memakai sertifikat self signed dan sudah diverifikasi manual:
   ```js
   tlsOptions: {
       rejectUnauthorized: process.env.NODE_ENV === 'production'
   }
   ```
   Untuk Gmail/Outlook/provider besar, `rejectUnauthorized: true` (nilai default yang aman) seharusnya berfungsi tanpa masalah.

5. Tidak ada rate limiting di seluruh API
   File: `server.js`, seluruh `src/routes/apiRoutes.js`
   Risiko: High
   Lihat detail solusi di bagian Audit API.

6. Tidak ada HTTP security headers (Helmet)
   File: `server.js`
   Risiko: Medium
   Masalah: tidak ada middleware seperti `helmet` yang mengatur header `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, dsb.
   Dampak: aplikasi bisa di-embed di iframe domain lain (risiko clickjacking pada tombol seperti "Delete address" atau "New Address"), browser lama berisiko MIME sniffing.
   Solusi:
   ```js
   const helmet = require('helmet');
   app.use(helmet({
       contentSecurityPolicy: false // aktifkan dan konfigurasikan CSP terpisah karena app memuat script dari CDN eksternal
   }));
   ```
   Perlu tambah dependency `helmet` ke `package.json`. CSP perlu dikonfigurasi khusus karena `index.html` memuat script dari `cdn.tailwindcss.com`, `unpkg.com`, dan font dari Google Fonts.

7. Sanitasi HTML email memakai whitelist manual, bukan library sanitasi teruji
   File: `public/js/script.js` fungsi `sanitizeHtml` baris 438-471
   Risiko: Medium
   Masalah: sanitasi dilakukan manual dengan menghapus tag tertentu (`script`, `iframe`, `object`, dst) dan atribut `on*`, tapi tidak menghapus tag `style` (bisa dipakai untuk CSS injection/UI redress di dalam area detail email), tidak menormalkan encoding yang bisa melewati filter regex sederhana (misalnya `javascript&#58;` atau spasi/tab tersembunyi di dalam `href`), dan tidak menangani SVG dengan event handler tersemat di dalam elemen yang tidak masuk daftar `dangerous`.
   Penyebab: solusi buatan sendiri untuk masalah yang biasanya diserahkan ke library khusus.
   Dampak: karena `detailBody.innerHTML` langsung merender HTML dari email pihak ketiga (baris 346 `script.js`), sanitizer yang kurang lengkap membuka kemungkinan XSS tersimpan (stored XSS lewat isi email) yang bisa mengeksekusi javascript di context aplikasi (bisa membaca `localStorage.currentEmail`, memicu aksi atas nama pengguna, dsb).
   Solusi: pakai library sanitasi HTML yang sudah teruji secara luas, misalnya `DOMPurify`, dimuat di frontend:
   ```html
   <script src="https://unpkg.com/dompurify@3/dist/purify.min.js"></script>
   ```
   ```js
   function sanitizeHtml(html) {
       return DOMPurify.sanitize(html, {
           FORBID_TAGS: ['style', 'form'],
           FORBID_ATTR: ['style']
       });
   }
   ```
   Solusi lebih aman lagi: render isi email di dalam elemen `<iframe sandbox="allow-same-origin">` terpisah dengan `srcdoc`, sehingga walaupun ada HTML/CSS berbahaya yang lolos, ia terisolasi dari DOM aplikasi utama dan tidak bisa mengakses `localStorage` atau memicu fungsi JavaScript aplikasi.

8. Pesan error internal diteruskan langsung ke klien
   File: `src/controllers/apiController.js` baris 89-91, `src/services/imapService.js` baris 328
   Risiko: Low
   Masalah: `error.message` dari exception IMAP diteruskan mentah mentah sebagai response JSON ke klien.
   Dampak: bisa membocorkan detail infrastruktur (nama host IMAP, jenis error autentikasi, dsb) ke pengguna akhir, walaupun tidak fatal.
   Solusi: log detail error di server, kembalikan pesan generik ke klien:
   ```js
   if (error) {
       console.error('IMAP error detail:', error);
       return res.status(503).json({ error: 'Mailbox temporarily unavailable, please retry.' });
   }
   ```

9. Environment variable `SESSION_SECRET` tidak dipakai di kode manapun
   Risiko: Low
   Masalah: secret `SESSION_SECRET` tersedia di environment tapi tidak ada satu pun referensi (`express-session`, `cookie-session`, atau pemakaian manual) di seluruh codebase.
   Dampak: bukan celah keamanan langsung, tapi ini adalah secret yang menganggur, menambah permukaan yang harus dijaga tanpa manfaat nyata saat ini. Bisa jadi sisa rencana fitur autentikasi/sesi yang belum dibangun.
   Solusi: jika autentikasi/sesi memang direncanakan (relevan untuk menutup temuan poin 2 dan 3 di atas), sambungkan `SESSION_SECRET` ke `express-session` saat fitur tersebut dibangun. Jika tidak ada rencana, hapus secret ini agar tidak menyesatkan.

10. Konkurensi pada koneksi IMAP tunggal yang dipakai bersama semua request
    File: `src/services/imapService.js` fungsi `fetchImapMessages` dan `fetchFromFolder` baris 207-278
    Risiko: Medium (integritas data, berpotensi menjadi kebocoran silang antar pengguna secara tidak sengaja)
    Masalah: seluruh request `getMessages` dari semua pengguna berbagi satu objek `connection` yang sama. Setiap pemanggilan `fetchFromFolder` melakukan `connection.openBox(folderName)` lalu `connection.search(...)`. Jika dua request datang hampir bersamaan (hal yang wajar di Node.js karena I/O bersifat non blocking), request A bisa saja baru membuka folder All Mail, lalu sebelum `search` selesai dieksekusi, request B ikut memanggil `openBox(spam)` pada koneksi yang sama, mengubah folder aktif di tengah proses pencarian request A.
    Penyebab: tidak ada mekanisme antrian/mutex untuk operasi IMAP yang stateful (folder aktif adalah state bersama pada satu koneksi).
    Dampak: pada kondisi race tertentu, hasil pencarian satu pengguna berpotensi tercampur atau kosong secara keliru karena folder yang aktif berubah di tengah operasi. Ini bisa terlihat sebagai bug "kadang pesan tidak muncul" yang sulit direproduksi.
    Solusi: serialisasi seluruh operasi yang menyentuh folder aktif memakai queue sederhana, misalnya dengan `p-queue` (concurrency 1) atau mutex manual:
    ```js
    let imapQueue = Promise.resolve();

    function runExclusive(task) {
        const result = imapQueue.then(task, task);
        imapQueue = result.catch(() => {});
        return result;
    }

    // pemakaian
    async function fetchFromFolder(folderName) {
        return runExclusive(async () => {
            await connection.openBox(folderName);
            return connection.search(searchCriteria, fetchOptions);
        });
    }
    ```
    Solusi lain: buka koneksi IMAP baru per request (lebih sederhana secara konsep, tapi lebih berat karena biaya koneksi TLS berulang, dan berisiko idle timeout dari provider jika terlalu banyak koneksi paralel dibuka).

11. `.bak` dan file HTML lama tersaji publik lewat static file server
    Risiko: Medium
    Lihat detail solusi di bagian Struktur Project.

12. Tidak ada validasi format/panjang input pada beberapa parameter query
    File: `src/controllers/apiController.js` fungsi `deleteEmail`, `getMessages` (parameter `email` dari query string dipakai langsung untuk `split('@')` tanpa validasi format email lebih dulu)
    Risiko: Low
    Dampak: input aneh seperti `?email=@@@` tidak menyebabkan crash (karena `split('@')[1] || ''` aman), tapi tetap sebaiknya divalidasi lebih awal supaya pesan error lebih jelas dan konsisten.
    Solusi: tambahkan validasi regex email sederhana sebelum diproses lebih lanjut, sama seperti yang sudah dilakukan di frontend (`public/js/script.js` baris 528).

Tidak ditemukan celah signifikan untuk kategori berikut pada kode yang diperiksa: SQL/Command Injection klasik (tidak ada query SQL atau `exec`/`spawn` shell di codebase), Path Traversal (tidak ada penggunaan path dari input pengguna untuk membaca file), Prototype Pollution langsung di kode aplikasi sendiri (risiko yang ada berasal dari dependency `axios` versi lama, lihat bagian Dependency Audit), CSRF (tidak relevan karena tidak ada autentikasi berbasis cookie/sesi yang bisa dibajak saat ini).

## 6. Audit Performa

- File: `server.js`
  Prioritas: Medium
  Masalah: tidak ada middleware compression (`compression`/gzip) untuk response JSON maupun file statis.
  Dampak: payload seperti hasil `gmail-generator` (bisa sampai 200 varian) atau daftar pesan dengan HTML email panjang terkirim tanpa kompresi, menambah waktu transfer terutama di koneksi lambat.
  Solusi:
  ```js
  const compression = require('compression');
  app.use(compression());
  ```

- File: `public/index.html`
  Prioritas: Medium
  Masalah: Tailwind CSS dimuat lewat CDN (`cdn.tailwindcss.com`) dan dikompilasi ulang di browser setiap kali halaman dibuka (terlihat dari warning browser: "cdn.tailwindcss.com should not be used in production").
  Dampak: waktu render awal lebih lambat dibanding Tailwind yang sudah dikompilasi jadi file CSS statis saat build, dan bergantung pada uptime CDN pihak ketiga.
  Solusi: pindahkan ke Tailwind CLI/PostCSS dengan build step yang menghasilkan satu file `.css` statis, disajikan lewat `express.static` seperti file lain.

- File: `src/services/imapService.js`, `fetchImapMessages`
  Prioritas: Low
  Masalah: setiap pesan diparsing ulang lewat `simpleParser` pada setiap polling (setiap 15 detik dari setiap klien aktif), padahal isi pesan yang sama kemungkinan besar tidak berubah antar polling.
  Dampak: penggunaan CPU berulang untuk parsing HTML/text yang identik, terutama jika ada beberapa klien aktif bersamaan.
  Solusi: tambahkan cache sederhana per `Message-ID` (in memory, dengan TTL wajar, misalnya 5 menit) supaya pesan yang sudah pernah diparsing tidak diparsing ulang pada polling berikutnya.

- Frontend (`public/js/script.js`)
  Prioritas: Low
  Masalah: `renderEmailList` melakukan `emailListContainer.innerHTML = ''` lalu membangun ulang seluruh daftar dari nol setiap kali ada polling baru, walau tidak ada perubahan data.
  Dampak: reflow/repaint DOM yang tidak perlu setiap 15 detik, terasa di daftar pesan yang panjang, walau untuk skala inbox temp mail (biasanya belasan pesan) dampaknya kecil.
  Solusi: bandingkan data baru dengan `allMessages` sebelumnya (misalnya dengan membandingkan daftar `id`), hanya re-render bila benar ada perubahan.

- Static asset (`public/images/logo.png`, `public/images/qr-donasi.png`, `public/favicon.png`)
  Prioritas: Low
  Masalah: tidak ada informasi kompresi/ukuran optimal untuk gambar (tidak diperiksa lebih jauh karena berupa binary, tapi tidak ada pipeline build image optimization).
  Solusi: kompres gambar dengan `sharp`/`squoosh` sebelum disimpan di repo bila filenya besar, gunakan format modern seperti WebP jika didukung target audiens.

Kesimpulan performa: tidak ada masalah performa kritis, backend cukup ringan karena arsitektur stateless. Peningkatan yang disarankan bersifat optimisasi, bukan perbaikan bug.

## 7. Audit Frontend

- HTML semantik: penggunaan elemen cukup baik (`header`, `nav`, `aside`, `section`), atribut ARIA dipakai pada beberapa tempat (`aria-haspopup`, `aria-expanded`, `role="button"` pada baris email). Beberapa tombol ikon murni (`icon-btn`) sudah diberi `aria-label`, tapi tidak semua (contoh: tombol quick actions "Random new address", "Custom address" di baris 308-313 index.html hanya punya `title`, tidak ada `aria-label`, `title` tidak cukup diakses oleh sebagian screen reader/perangkat sentuh).
  Prioritas: Low
  Solusi: tambahkan `aria-label` yang senada dengan `title` pada seluruh `icon-btn` yang hanya berisi ikon.

- Responsive/mobile friendly: sudah ada breakpoint `sm`/`md`/`lg` yang konsisten, sidebar berubah jadi drawer di mobile, ada mobile email bar dan mobile search terpisah. Ini sudah dikerjakan dengan baik.

- Loading state: ada (`setLoading` mengubah teks tombol dan disable saat proses generate berlangsung).

- Empty state: ada (`emptyState` dengan ikon dan teks penjelasan).

- Error state: ditangani lewat toast (`showToast`), sudah cukup jelas untuk pengguna, tapi beberapa pesan error frontend memakai Bahasa Indonesia (misalnya "Masukkan alamat Gmail terlebih dahulu") sementara sebagian besar UI dan pesan lain memakai Bahasa Inggris (misalnya "Please enter a valid email address"). Ini murni inkonsistensi bahasa antarmuka.
  Prioritas: Low
  Solusi: tetapkan satu bahasa utama untuk seluruh UI (atau sediakan i18n proper dengan file terjemahan terpisah bila memang ingin dwibahasa), lalu samakan semua string.

- Memory leak potensial: `document.addEventListener('click', ...)` untuk sidebar (baris 628-634 `script.js`) dan untuk domain selector (baris 71-76) dipasang sekali di level modul, tidak pernah dilepas, tapi karena elemen terkait (`sidebar`, `customDomainSelector`) juga tidak pernah dihancurkan/dibuat ulang selama siklus hidup halaman (SPA satu halaman penuh, bukan router yang memasang ulang komponen), risiko leak nyata sangat kecil dalam pola penggunaan saat ini.
  Prioritas: Low, hanya dicatat sebagai potensi jika aplikasi berkembang jadi multi-page/SPA dengan router di masa depan.

- Event listener pada elemen yang dibuat ulang: `renderEmailList` membuat elemen baru dan memasang `row.onclick`/`row.addEventListener` setiap render (baris 316-317), elemen lama dibuang lewat `innerHTML = ''` sehingga listener lama otomatis dibersihkan oleh garbage collector browser. Tidak ada leak di sini, ini pola yang aman meski tidak paling efisien (lihat catatan performa render ulang di atas).

- Accessibility warna kontras: memakai palet Tailwind standar (`slate`, `primary` biru), secara umum kontras teks terhadap background sudah wajar untuk light dan dark mode, tidak ditemukan kombinasi teks abu terang di atas putih yang terlalu tipis untuk dibaca dalam pemeriksaan kode (perlu pengecekan visual langsung untuk memastikan rasio kontras WCAG AA secara presisi, di luar cakupan pembacaan kode statis).

Kesimpulan frontend: kualitas UI/UX sudah cukup modern dan mobile friendly, isu yang ada bersifat kerapian aksesibilitas dan konsistensi bahasa, bukan bug fungsional.

## 8. Temp Mail UX

- Auto refresh inbox: ada, setiap 15 detik (`startPolling`, baris 483-487 `script.js`).
- Duplikasi email: dicegah di sisi backend lewat deduplikasi `Message-ID` (`imapService.js` baris 236-251), dan di sisi frontend data selalu diganti penuh dari response terbaru (bukan digabung), sehingga tidak ada duplikasi tampilan.
- Loading cepat: bergantung pada latensi IMAP, tapi ada mekanisme "warm connection" saat startup server (baris 371-376 `imapService.js`) supaya request pertama tidak menunggu proses connect dari nol. Ini keputusan desain yang baik.
- Error mudah dipahami: pesan toast sudah cukup deskriptif untuk error yang umum (domain tidak valid, username tidak valid, dsb).
- Copy email dan copy isi email: ada tombol copy alamat (`copyEmail`) dengan fallback untuk browser tanpa Clipboard API (`fallbackCopy`), sudah baik. Copy isi email penuh (bukan cuma alamat) tidak ditemukan sebagai fitur terpisah, pengguna hanya bisa membaca isi email di `detailBody`, tidak ada tombol "copy isi email".
  Prioritas: Low (peningkatan UX opsional)
  Solusi: tambahkan tombol copy pada `detailBody` yang menyalin `msg.text` (bukan HTML mentah) ke clipboard.
- Real time: tidak real time murni (polling 15 detik), sudah dibahas di bagian Alur Bisnis.
- Navigasi: sederhana dan jelas, satu sidebar dengan aksi utama, transisi antar "halaman" (Gmail Generator, Donasi, Tentang) memakai slide panel di dalam SPA, bukan reload/navigasi baru, ini pengalaman yang mulus.
- Tampilan modern seperti aplikasi mobile: tercapai, terutama lewat pola app shell (sidebar + main + slide panel) dan mobile email bar terpisah.

Kesimpulan UX temp mail: sudah memenuhi hampir semua kriteria yang diharapkan pengguna layanan temp mail modern, kekurangan hanya pada fitur real time push dan copy isi email, keduanya bersifat peningkatan bukan kekurangan mendasar.

## 9. Dependency Audit

Hasil `npm outdated`:

| Package | Current | Wanted | Latest |
|---|---|---|---|
| axios | 1.13.2 | 1.18.1 | 1.18.1 |
| dotenv | 17.2.3 | 17.4.2 | 17.4.2 |
| mailparser | 3.9.1 | 3.9.14 | 3.9.14 |

Hasil `npm audit`:

- Prioritas: High
  Package: `axios` versi `^1.13.2`.
  Temuan: beberapa CVE aktif pada rentang versi yang terpasang, di antaranya SSRF lewat bypass normalisasi `NO_PROXY` (GHSA-3p68-rc4w-qgx5, severity moderate hingga high tergantung varian, skor CVSS sampai 7.2), autentikasi bypass lewat prototype pollution di strategi merge `validateStatus` (GHSA-w9j2-pvgh-6h63), serta tampering response JSON tanpa terlihat lewat `parseReviver` (GHSA-3w6x-2g7m-8v23).
  Relevansi ke aplikasi ini: `axios` dipakai di `src/services/cloudflareService.js.bak` untuk memanggil Cloudflare API. Karena file ini sudah tidak aktif dipakai (lihat temuan struktur project di atas), risiko eksploitasi langsung saat ini rendah, tapi tetap tercatat sebagai vulnerable dependency yang aktif terinstall di `node_modules` dan `package.json`.
  Solusi: naikkan ke versi `1.18.1` lewat `npm install axios@latest`, atau jika `cloudflareService.js.bak` memang tidak dipakai, hapus dependency `axios` sepenuhnya dari `package.json` untuk mengecilkan permukaan serangan.

- Prioritas: Low
  Package: `dotenv`, `mailparser`.
  Temuan: tidak ada CVE aktif yang dilaporkan `npm audit` untuk kedua package ini pada versi yang terpasang, hanya tertinggal dari versi terbaru (patch/minor release biasa).
  Solusi: naikkan ke versi terbaru secara berkala lewat `npm update`, tidak mendesak.

- Package yang tidak digunakan: tidak ditemukan dependency di `package.json` yang benar benar tidak dipakai di kode aktif. `axios` dipakai hanya oleh file `.bak` yang tidak aktif, jadi secara efektif menganggur untuk alur bisnis saat ini meski secara teknis "dipakai" oleh file yang masih ada di repo.

- Package yang sebaiknya ditambahkan (bukan diganti, tapi melengkapi): `helmet` (security headers), `express-rate-limit` (rate limiting), `compression` (kompresi response). Ketiganya dibahas di bagian Keamanan/Performa di atas.

- Konflik versi: tidak ditemukan konflik versi antar dependency di `package-lock.json`.

## 10. Rekomendasi Refactoring

Urutan refactoring yang disarankan, diurutkan dari yang paling berdampak:

1. Tutup kebocoran data lewat endpoint `/api/debug/emails` (hapus atau lindungi).
2. Naikkan entropi pembuatan alamat email dan pertimbangkan token kepemilikan alamat, untuk menutup risiko pembacaan inbox lintas pengguna.
3. Aktifkan verifikasi sertifikat TLS untuk koneksi IMAP di production.
4. Tambahkan rate limiting global di `/api`.
5. Ganti sanitizer HTML manual dengan `DOMPurify`, atau render email di dalam `iframe sandbox`.
6. Serialisasi operasi IMAP yang stateful (folder aktif) memakai queue/mutex sederhana untuk mencegah race condition antar request.
7. Bersihkan file mati (`*.bak`, `index2.html`, CSS yang tidak dipakai) dan tambahkan `.gitignore`.
8. Naikkan versi `axios` atau hapus jika memang tidak dipakai lagi.
9. Tambahkan `helmet` dan `compression` sebagai middleware standar.
10. Perjelas kejujuran response API (`deleteEmail`, `listEmails`) agar sesuai dengan apa yang benar benar terjadi di backend.

Semua rekomendasi di atas dirancang agar tetap kompatibel dengan alur bisnis dan fitur yang sudah ada, tidak ada fitur yang perlu dihapus untuk menerapkannya.

## Ringkasan Akhir

Skor (skala 0 sampai 100, semakin tinggi semakin baik):

- Skor Arsitektur: 72
- Skor Kualitas Kode: 78
- Skor Keamanan: 40
- Skor Performa: 70
- Skor API: 60
- Skor Frontend: 80
- Skor UX: 82

Penjelasan singkat skor keamanan yang paling rendah: aplikasi ini pada dasarnya tidak punya lapisan otentikasi/otorisasi sama sekali, ditambah satu endpoint debug yang membocorkan data pengguna lain secara langsung, dan verifikasi TLS yang dinonaktifkan. Ketiga hal ini yang paling menekan skor keamanan meski bagian lain (sanitasi input domain/username, validasi query, penanganan error try/catch) sudah dikerjakan dengan baik.

Daftar prioritas perbaikan dari yang paling penting:

1. Hapus atau lindungi endpoint `/api/debug/emails` (Critical).
2. Tinjau ulang model kepemilikan alamat email di `getMessages` (Critical, keputusan produk).
3. Naikkan entropi generator alamat email (High).
4. Aktifkan verifikasi sertifikat TLS IMAP di production (High).
5. Tambahkan rate limiting di seluruh `/api` (High).
6. Ganti sanitizer HTML manual dengan solusi teruji seperti DOMPurify (Medium).
7. Perbaiki race condition pada koneksi IMAP bersama (Medium).
8. Bersihkan file mati dan tambahkan `.gitignore` (Medium).
9. Naikkan versi `axios` atau hapus dependency yang tidak terpakai (High untuk severity CVE, Medium untuk relevansi nyata).
10. Tambahkan `helmet` dan `compression` (Medium).
11. Perbaiki kejujuran response `deleteEmail`/`listEmails`, konsistensi bahasa UI, dan penambahan fitur pendukung (copy isi email, attachment) sebagai peningkatan lanjutan (Low sampai Medium).
