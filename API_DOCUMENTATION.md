# 📖 REVDMAIL REST API Documentation

Dokumentasi resmi penggunaan REST API layanan temporary email **REVDMAIL** (`https://mail.revd.me`).

REVDMAIL menyediakan REST API publik berkecepatan tinggi tanpa registrasi untuk pembuatan email sementara, penerimaan pesan (inbox), pembacaan isi pesan penuh, deteksi kode OTP, dan varian Gmail Dot Trick.

---

## 🚀 Ringkasan & Konfigurasi Dasar

| Parameter | Nilai |
| :--- | :--- |
| **Base URL** | `https://mail.revd.me/api` |
| **Autentikasi** | **Public / None** (Tidak memerlukan API Key / Token) |
| **Format Data** | `application/json` |
| **Rate Limit** | **60 request / menit** per alamat IP klien |
| **CORS** | Didukung (Bisa diakses dari frontend web apa pun) |

---

## 📌 Daftar Endpoint

| Method | Endpoint | Deskripsi |
| :---: | :--- | :--- |
| `GET` | `/api/domains` | Mengambil daftar domain aktif yang didukung |
| `POST` | `/api/create` | Membuat alamat email acak baru atau kustom |
| `GET` | `/api/messages` | Mengambil daftar pesan masuk (inbox) |
| `GET` | `/api/message/:id` | Mengambil detail isi lengkap pesan berdasarkan ID/UID |
| `DELETE` | `/api/delete` | Menghapus sesi email aktif |
| `GET` | `/api/gmail-generator` | Menghasilkan variasi dot trick Gmail |

---

## 1. Ambil Domain Tersedia (`GET /api/domains`)

Mengembalikan daftar domain yang aktif dan dapat digunakan untuk membuat alamat email.

### Request
```bash
curl -s "https://mail.revd.me/api/domains"
```

### Response (`200 OK`)
```json
{
  "domains": [
    "revd.me"
  ]
}
```

---

## 2. Buat Alamat Email Baru (`POST /api/create`)

Membuat alamat email sementara baru. Bisa membuat alamat acak instan atau menentukan username dan domain kustom.

### Header
```http
Content-Type: application/json
```

### Body (JSON - Opsional)
```json
{
  "username": "customuser123",  // Opsional (huruf, angka, titik, strip, underscore; maks 64 char)
  "domain": "revd.me"           // Opsional (harus salah satu dari domain /api/domains)
}
```

### Contoh Request

#### A. Email Acak Instan:
```bash
curl -X POST "https://mail.revd.me/api/create"
```

#### B. Email Kustom:
```bash
curl -X POST "https://mail.revd.me/api/create" \
  -H "Content-Type: application/json" \
  -d '{"username": "revaldi-test", "domain": "revd.me"}'
```

### Response (`200 OK`)
```json
{
  "email": "revaldi-test@revd.me",
  "expires_at": null
}
```

---

## 3. Ambil Kotak Masuk / Inbox (`GET /api/messages`)

Mengambil daftar ringkasan pesan masuk untuk alamat email tertentu.

### Query Parameters
| Parameter | Tipe | Wajib | Deskripsi |
| :--- | :---: | :---: | :--- |
| `email` | `string` | **Ya** | Alamat email target lengkap (contoh: `user@revd.me`) |

### Contoh Request
```bash
curl -s "https://mail.revd.me/api/messages?email=revaldi-test@revd.me"
```

### Response (`200 OK`)
```json
{
  "messages": [
    {
      "id": 2083,
      "subject": "Kode Verifikasi Pendaftaran Anda: 489102",
      "from": "Acme Service <no-reply@acme.com>",
      "from_email": "no-reply@acme.com",
      "date": "2026-09-10T19:00:11.000Z",
      "intro": "Halo, berikut adalah kode verifikasi akun Anda: 489102. Kode ini berlaku selama 10 menit.",
      "has_attachments": false
    }
  ]
}
```

*Catatan: Kolom `id` adalah UID pesan unik yang digunakan untuk mengambil konten lengkap pada endpoint `/api/message/:id`.*

---

## 4. Ambil Detail Isi Pesan (`GET /api/message/:id`)

Memuat konten lengkap pesan email (termasuk HTML yang telah dibersihkan, plain text, dan daftar lampiran jika ada).

### Path & Query Parameters
| Parameter | Letak | Wajib | Deskripsi |
| :--- | :---: | :---: | :--- |
| `:id` | Path | **Ya** | UID pesan (didapat dari respon `/api/messages`) |
| `email` | Query | **Ya** | Alamat email penerima (untuk verifikasi kepemilikan/isolasi keamanan) |

### Contoh Request
```bash
curl -s "https://mail.revd.me/api/message/2083?email=revaldi-test@revd.me"
```

### Response (`200 OK`)
```json
{
  "message": {
    "id": 2083,
    "subject": "Kode Verifikasi Pendaftaran Anda: 489102",
    "from": "Acme Service <no-reply@acme.com>",
    "from_email": "no-reply@acme.com",
    "to": "revaldi-test@revd.me",
    "date": "2026-09-10T19:00:11.000Z",
    "text": "Halo, berikut adalah kode verifikasi akun Anda: 489102.\nKode ini berlaku selama 10 menit.",
    "html": "<div><p>Halo, berikut adalah kode verifikasi akun Anda: <strong>489102</strong>.</p></div>",
    "attachments": []
  }
}
```

---

## 5. Generator Varian Dot Trick Gmail (`GET /api/gmail-generator`)

Menghasilkan hingga 200 kombinasi titik (*dot trick*) dari sebuah alamat Gmail. Google memperlakukan semua variasi bertitik sama dengan alamat aslinya tanpa titik.

### Query Parameters
| Parameter | Tipe | Wajib | Deskripsi |
| :--- | :---: | :---: | :--- |
| `email` | `string` | **Ya** | Alamat Gmail (contoh: `namakamu@gmail.com`) |

### Contoh Request
```bash
curl -s "https://mail.revd.me/api/gmail-generator?email=namakamu@gmail.com"
```

### Response (`200 OK`)
```json
{
  "variants": [
    "namakamu@gmail.com",
    "n.amakamu@gmail.com",
    "na.makamu@gmail.com",
    "nam.akamu@gmail.com",
    "nama.kamu@gmail.com"
  ],
  "truncated": false,
  "total": 5
}
```

---

## 6. Hapus Sesi Email (`DELETE /api/delete`)

Menghapus sesi email saat ini dari klien.

### Request
```bash
curl -X DELETE "https://mail.revd.me/api/delete?email=revaldi-test@revd.me"
```

### Response (`200 OK`)
```json
{
  "message": "Alamat revaldi-test@revd.me telah dibersihkan dari sesi ini."
}
```

---

## 🌐 Akses Langsung Web via URL Query

Selain melalui API, web REVDMAIL mendukung akses langsung ke kotak masuk mana pun secara instan menggunakan query parameter:

```text
https://mail.revd.me/?email=revaldi-test@revd.me
```

Format ini mempermudah integrasi dengan bot Telegram/WhatsApp atau script otomatisasi browser: saat URL dibuka, web otomatis memuat kotak masuk alamat tersebut tanpa perlu menekan tombol apa pun.

---

## 💻 Contoh Integrasi Kode

### A. JavaScript / Node.js (Polling Kode OTP Otomatis)

```javascript
// revdmail-bot.js
const BASE = 'https://mail.revd.me/api';

async function waitForOTP() {
    // 1. Buat alamat email acak
    const createRes = await fetch(`${BASE}/create`, { method: 'POST' });
    const { email } = await createRes.json();
    console.log(`[+] Email dibuat: ${email}`);
    console.log(`[+] Akses web: https://mail.revd.me/?email=${email}`);

    // 2. Lakukan pendaftaran pada target service menggunakan email ini...
    // registerService(email);

    // 3. Polling pesan masuk setiap 3-4 detik
    console.log('[*] Menunggu pesan masuk & kode OTP...');
    const startTime = Date.now();
    const timeoutMs = 60000; // batas tunggu 60 detik

    while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${BASE}/messages?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (data.messages && data.messages.length > 0) {
            const latest = data.messages[0];
            console.log(`[+] Pesan diterima dari: ${latest.from}`);
            console.log(`[+] Subjek: ${latest.subject}`);

            // Ekstraksi kode verifikasi 4-8 digit
            const combinedText = `${latest.subject} ${latest.intro || ''}`;
            const otpMatch = combinedText.match(/\b\d{4,8}\b/);
            if (otpMatch) {
                console.log(`[✓] KODE OTP DITEMUKAN: ${otpMatch[0]}`);
                return otpMatch[0];
            }
        }

        // Tunggu 3.5 detik sebelum poll berikutnya
        await new Promise(r => setTimeout(r, 3500));
    }

    throw new Error('Timeout: Tidak ada pesan masuk setelah 60 detik.');
}

waitForOTP().catch(console.error);
```

---

### B. Python 3 (`requests`)

```python
import time
import re
import requests

BASE_URL = "https://mail.revd.me/api"

def get_temp_email():
    resp = requests.post(f"{BASE_URL}/create")
    resp.raise_for_status()
    return resp.json()["email"]

def poll_for_otp(email, timeout=60, interval=3.5):
    print(f"[*] Email Aktif: {email}")
    print(f"[*] Cek di web: https://mail.revd.me/?email={email}")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        res = requests.get(f"{BASE_URL}/messages", params={"email": email})
        if res.status_code == 200:
            messages = res.json().get("messages", [])
            if messages:
                latest = messages[0]
                text = f"{latest.get('subject', '')} {latest.get('intro', '')}"
                match = re.search(r'\b\d{4,8}\b', text)
                if match:
                    otp = match.group(0)
                    print(f"[✓] OTP Ditemukan: {otp}")
                    return otp
        time.sleep(interval)
    
    print("[-] Timeout: Pesan tidak ditemukan.")
    return None

if __name__ == "__main__":
    email = get_temp_email()
    poll_for_otp(email)
```

---

### C. cURL / Bash Script One-Liner

```bash
# 1. Buat email baru dan simpan ke variabel
EMAIL=$(curl -s -X POST https://mail.revd.me/api/create | jq -r '.email')
echo "Email: $EMAIL"

# 2. Cek pesan masuk
curl -s "https://mail.revd.me/api/messages?email=$EMAIL" | jq .
```

---

## 🛡️ Keamanan & Isolasi Data
- Setiap request pembacaan pesan `/api/message/:id` memvalidasi kesesuaian penerima email (`RFC 5322 Recipient Match`), mencegah penyerang mengakses pesan pengguna lain.
- Rendering HTML pesan dibersihkan dari skrip berbahaya (XSS) dan disajikan dalam iframe terisolasi (`sandbox="allow-same-origin allow-popups"`).
- Alamat email bersifat sementara (*disposable*).
