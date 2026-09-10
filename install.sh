#!/usr/bin/env bash
# ==============================================================================
# REVDMAIL - Automated Installer & Production Setup Script
# Author: Senior Developer
# Platform: Ubuntu 20.04 / 22.04 / 24.04 & Debian 11 / 12
# ==============================================================================

set -euo pipefail

# --- Color Definitions ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Helper Functions ---
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_banner() {
    clear 2>/dev/null || true
    echo -e "${CYAN}${BOLD}"
    echo "================================================================="
    echo "       ____  _______     ______  __  ___ ___    ________     "
    echo "      / __ \/ ____/ |   / / __ \/  |/  //   |  /  _/ /      "
    echo "     / /_/ / __/  | |  / / / / / /|_/ // /| |  / // /       "
    echo "    / _, _/ /___  | | / / /_/ / /  / // ___ |_/ // /___     "
    echo "   /_/ |_/_____/  |___/_____/_/  /_//_/  |_/___/_____/     "
    echo "                                                                 "
    echo "        Automated Server Installer & Production Setup            "
    echo "================================================================="
    echo -e "${NC}"
}

# --- 1. Root & Environment Checks ---
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Script ini harus dijalankan sebagai user root (gunakan: sudo bash install.sh)."
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "Sistem operasi tidak dikenali. Script ini membutuhkan Ubuntu atau Debian."
        exit 1
    fi

    source /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        log_warn "OS terdeteksi: $NAME. Disarankan menggunakan Ubuntu 20.04+ atau Debian 11+."
    else
        log_success "OS kompatibel: $NAME ($VERSION_ID)"
    fi
}

# --- 2. Interactive Input Collection ---
get_server_ip() {
    curl -s -4 https://ifconfig.me || curl -s -4 https://api.ipify.org || echo "Unknown"
}

prompt_configuration() {
    local detected_ip
    detected_ip=$(get_server_ip)

    echo -e "\n${BOLD}=== Konfigurasi Domain & Layanan ===${NC}"
    echo -e "IP Server Terdeteksi : ${CYAN}${detected_ip}${NC}\n"

    # Primary Web Domain
    while true; do
        read -rp "1. Domain Website (contoh: mail.domainmu.com): " DOMAIN_NAME
        DOMAIN_NAME=$(echo "$DOMAIN_NAME" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [[ -n "$DOMAIN_NAME" && "$DOMAIN_NAME" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
            break
        else
            log_warn "Format domain tidak valid. Silakan coba lagi."
        fi
    done

    # Check DNS Resolution
    log_info "Memeriksa pointing DNS untuk $DOMAIN_NAME..."
    local resolved_ip
    resolved_ip=$(dig +short A "$DOMAIN_NAME" 2>/dev/null | tail -n1 || echo "")

    if [[ -n "$resolved_ip" && "$resolved_ip" == "$detected_ip" ]]; then
        log_success "Domain $DOMAIN_NAME berhasil terarah ke IP server ($resolved_ip)."
    else
        log_warn "Domain $DOMAIN_NAME mengarah ke ($resolved_ip), sedangkan IP server adalah ($detected_ip)."
        log_warn "Jika menggunakan Cloudflare (Proxied), pastikan SSL mode adalah 'Full' atau 'Flexible'."
        read -rp "Lanjutkan instalasi? (y/n) [default: y]: " CONFIRM_DNS
        CONFIRM_DNS=${CONFIRM_DNS:-y}
        if [[ "$CONFIRM_DNS" != "y" && "$CONFIRM_DNS" != "Y" ]]; then
            log_error "Instalasi dibatalkan. Pastikan DNS sudah dipointing terlebih dahulu."
            exit 1
        fi
    fi

    # Available Temp Mail Domains
    read -rp "2. Domain Email Temporary (pisahkan koma jika banyak, contoh: domainmu.com,mail.domainmu.com): " AVAILABLE_DOMAINS
    AVAILABLE_DOMAINS=${AVAILABLE_DOMAINS:-$DOMAIN_NAME}

    # Port
    read -rp "3. Port Internal Node.js [default: 5005]: " APP_PORT
    APP_PORT=${APP_PORT:-5005}

    # Target Install Directory
    read -rp "4. Direktori Instalasi [default: /var/www/revdmail]: " INSTALL_DIR
    INSTALL_DIR=${INSTALL_DIR:-/var/www/revdmail}

    echo -e "\n${BOLD}=== Konfigurasi IMAP (Gmail / Custom Server) ===${NC}"
    read -rp "5. IMAP Server Host [default: imap.gmail.com]: " IMAP_SERVER
    IMAP_SERVER=${IMAP_SERVER:-imap.gmail.com}

    read -rp "6. IMAP Port [default: 993]: " IMAP_PORT
    IMAP_PORT=${IMAP_PORT:-993}

    while true; do
        read -rp "7. IMAP User / Email Akun Penerima (contoh: akunmu@gmail.com): " IMAP_USER
        IMAP_USER=$(echo "$IMAP_USER" | tr -d '[:space:]')
        if [[ -n "$IMAP_USER" && "$IMAP_USER" =~ @ ]]; then
            break
        else
            log_warn "Email IMAP tidak boleh kosong dan harus memiliki format yang benar."
        fi
    done

    while true; do
        read -rsp "8. IMAP Password / App Password Gmail: " IMAP_PASSWORD
        echo ""
        if [[ -n "$IMAP_PASSWORD" ]]; then
            break
        else
            log_warn "Password IMAP tidak boleh kosong."
        fi
    done

    # Certbot Email
    echo -e "\n${BOLD}=== Konfigurasi Sertifikat SSL Let's Encrypt ===${NC}"
    read -rp "9. Email Notifikasi SSL Certbot (contoh: admin@domainmu.com): " CERTBOT_EMAIL
    CERTBOT_EMAIL=${CERTBOT_EMAIL:-$IMAP_USER}
}

# --- 3. Install System Dependencies ---
install_dependencies() {
    log_info "Memperbarui paket sistem dan menginstall dependensi dasar..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl git ufw nginx certbot python3-certbot-nginx dnsutils build-essential

    # Check & Install Node.js (Require Node >= 18, prefer Node 20 LTS)
    local need_node_install=false
    if ! command -v node &>/dev/null; then
        need_node_install=true
    else
        local node_ver
        node_ver=$(node -v | tr -d 'v' | cut -d. -f1)
        if (( node_ver < 18 )); then
            log_warn "Node.js versi terpasang ($node_ver) terlalu usang. Mengupgrade ke Node.js 20 LTS..."
            need_node_install=true
        else
            log_success "Node.js terpasang: $(node -v)"
        fi
    fi

    if [[ "$need_node_install" == true ]]; then
        log_info "Menginstall Node.js 20 LTS dari NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        log_success "Node.js $(node -v) dan npm $(npm -v) berhasil diinstall."
    fi

    # Check & Install PM2
    if ! command -v pm2 &>/dev/null; then
        log_info "Menginstall PM2 Process Manager secara global..."
        npm install -g pm2
        log_success "PM2 berhasil diinstall."
    else
        log_success "PM2 sudah terpasang: $(pm2 -v)"
    fi
}

# --- 4. Deploy Files & Setup App ---
setup_application() {
    log_info "Menyiapkan direktori aplikasi di $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"

    local current_dir
    current_dir=$(pwd)

    # Copy files if running from within revdmail source repo
    if [[ -f "$current_dir/server.js" && -f "$current_dir/package.json" ]]; then
        log_info "Menyalin file source code dari $current_dir..."
        cp -r "$current_dir"/* "$INSTALL_DIR"/
        # Also copy hidden files except git
        cp -r "$current_dir"/.env.example "$INSTALL_DIR"/ 2>/dev/null || true
    else
        log_error "File server.js tidak ditemukan di direktori saat ini. Jalankan script ini dari dalam folder source code REVDMAIL."
        exit 1
    fi

    cd "$INSTALL_DIR"

    # Generate .env file
    log_info "Membuat file konfigurasi .env..."
    cat > "$INSTALL_DIR/.env" <<EOF
PORT=$APP_PORT
AVAILABLE_DOMAINS=$AVAILABLE_DOMAINS
IMAP_SERVER=$IMAP_SERVER
IMAP_PORT=$IMAP_PORT
IMAP_USER=$IMAP_USER
IMAP_PASSWORD=$IMAP_PASSWORD
IMAP_ALLOW_INSECURE_TLS=false
NODE_ENV=production
EOF

    chmod 600 "$INSTALL_DIR/.env"
    log_success "File .env berhasil dibuat dengan izin akses terisolasi (600)."

    # Install NPM Dependencies
    log_info "Menginstall dependensi Node.js via npm..."
    npm install --omit=dev
    log_success "Dependensi Node.js selesai diinstall."

    # Run automated self-checks
    if [[ -f "$INSTALL_DIR/tests/self_check.js" ]]; then
        log_info "Menjalankan internal self-check..."
        node tests/self_check.js
    fi
}

# --- 5. Setup Nginx & SSL ---
setup_nginx() {
    log_info "Mengonfigurasi Reverse Proxy Nginx untuk $DOMAIN_NAME..."

    local nginx_conf="/etc/nginx/sites-available/revdmail"
    cat > "$nginx_conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    # Basic DDoS & Client Limiting
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_buffering off;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

    ln -sf "$nginx_conf" /etc/nginx/sites-enabled/revdmail
    # Remove default site if it exists
    rm -f /etc/nginx/sites-enabled/default

    log_info "Menguji sintaks konfigurasi Nginx..."
    nginx -t
    systemctl reload nginx
    log_success "Nginx berhasil dikonfigurasi dan direload."

    # Certbot SSL Setup
    log_info "Mengajukan sertifikat SSL Let's Encrypt untuk $DOMAIN_NAME..."
    if certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
        log_success "Sertifikat SSL Let's Encrypt berhasil diinstall dan auto-redirect HTTPS aktif!"
    else
        log_warn "Certbot gagal memasang sertifikat otomatis. Kemungkinan DNS belum selesai propagasi atau Cloudflare Proxy aktif."
        log_warn "Aplikasi tetap dapat berjalan di HTTP port 80. Anda dapat menjalankan Certbot nanti via: certbot --nginx -d $DOMAIN_NAME"
    fi
}

# --- 6. Firewall Configuration ---
setup_firewall() {
    log_info "Mengonfigurasi firewall (UFW)..."
    ufw allow OpenSSH || ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    # Ensure internal port is not accessible from WAN
    ufw deny "$APP_PORT"/tcp 2>/dev/null || true
    ufw --force enable
    log_success "Firewall aktif: Port 22, 80, 443 diizinkan. Port internal $APP_PORT terlindungi."
}

# --- 7. PM2 Daemon Management ---
setup_pm2() {
    log_info "Menjalankan aplikasi REVDMAIL di PM2..."
    cd "$INSTALL_DIR"

    # Stop and delete old instance if exists
    pm2 delete revdmail 2>/dev/null || true

    # Start application
    pm2 start server.js --name "revdmail" --time
    pm2 save

    # Ensure PM2 starts on system boot
    local pm2_startup_cmd
    pm2_startup_cmd=$(pm2 startup systemd -u root --hp /root | grep 'sudo env' || true)
    if [[ -n "$pm2_startup_cmd" ]]; then
        eval "$pm2_startup_cmd" 2>/dev/null || true
    fi

    log_success "Aplikasi REVDMAIL aktif di PM2."
}

# --- 8. Health Check & Summary ---
verify_health() {
    log_info "Memverifikasi kesehatan service lokal..."
    sleep 3

    local health_code
    health_code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$APP_PORT/api/domains" || echo "000")

    if [[ "$health_code" == "200" ]]; then
        log_success "Health check BERHASIL (HTTP 200 OK)."
    else
        log_warn "Health check lokal menghasilkan HTTP $health_code. Periksa log: pm2 logs revdmail"
    fi
}

print_summary() {
    echo -e "\n${GREEN}${BOLD}"
    echo "================================================================="
    echo "       🎉 INSTALASI REVDMAIL BERHASIL DISELESAIKAN!             "
    echo "================================================================="
    echo -e "${NC}"
    echo -e "URL Layanan       : ${CYAN}https://${DOMAIN_NAME}${NC}"
    echo -e "Direktori App     : ${INSTALL_DIR}"
    echo -e "Port Internal     : 127.0.0.1:${APP_PORT}"
    echo -e "Domain Temporary  : ${AVAILABLE_DOMAINS}"
    echo -e "Akun Forwarding   : ${IMAP_USER}"
    echo ""
    echo -e "${BOLD}--- Langkah Terakhir: Setup Cloudflare Email Routing ---${NC}"
    echo "1. Buka dashboard Cloudflare untuk domain temporary (${AVAILABLE_DOMAINS})."
    echo "2. Masuk ke menu 'Email Routing' -> aktifkan."
    echo "3. Masukkan MX dan TXT DNS records yang diminta Cloudflare."
    echo "4. Pada tab 'Routing Rules', buat 'Catch-all rule':"
    echo "   - Action: Send to an email"
    echo "   - Destination address: ${IMAP_USER}"
    echo ""
    echo -e "${BOLD}--- Perintah Berguna ---${NC}"
    echo "• Cek status bot/app : pm2 status"
    echo "• Lihat live logs     : pm2 logs revdmail"
    echo "• Restart aplikasi   : pm2 restart revdmail"
    echo "• Reload Nginx       : systemctl reload nginx"
    echo "================================================================="
}

# --- Main Execution Flow ---
main() {
    print_banner
    check_root
    check_os
    prompt_configuration
    install_dependencies
    setup_application
    setup_nginx
    setup_firewall
    setup_pm2
    verify_health
    print_summary
}

main "$@"
