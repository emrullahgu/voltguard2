# VoltGuard CI — Ubuntu sunucu kurulumu

GitHub Actions'tan bağımsız, ücretsiz test hattı. Sunucu 3 dakikada bir `main` ve bu depodan açılmış PR'ların
son commit'lerine bakar; yeni bir commit varsa testleri Docker konteynerinde çalıştırır ve sonucu GitHub'da
commit durumu (`voltguard-ci`) olarak gösterir. Fork'tan gelen PR'lar test edilmez (sunucuda yabancı kod çalışmaz).

## Konteyner sınırları
- Ağ yok (`--network none`), 2 CPU, 2 GB bellek, 512 işlem, `no-new-privileges`, kullanıcı `emrullah` (root değil).
- systemd: `Nice=15`, `IOSchedulingClass=idle` — üretim konteynerlerinin önüne geçmez.
- İmaj sunucudaki `image/Dockerfile`'dan kurulur; PR'daki Dockerfile kullanılmaz.

## Dosyalar
| Sunucuda | Kaynak |
|---|---|
| `~/servisler/voltguard-ci/voltguard-ci.sh` | `tools/ci/voltguard-ci.sh` |
| `~/servisler/voltguard-ci/image/Dockerfile` | `tools/ci/Dockerfile` |
| `~/servisler/voltguard-ci/token` | GitHub erişim anahtarı (aşağıda), `chmod 600` |
| `/etc/systemd/system/voltguard-ci.service`, `.timer` | `tools/ci/voltguard-ci.service`, `.timer` |

## Erişim anahtarı (depo sahibi oluşturur)
GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
- Repository access: **Only select repositories → emrullahgu/voltguard2**
- Permissions → Repository: **Commit statuses: Read and write** (Metadata: Read otomatik gelir)

Sunucuda anahtarı ekrana yazmadan kaydetmek için:
```bash
read -rs -p "Token: " T && printf '%s' "$T" > ~/servisler/voltguard-ci/token && chmod 600 ~/servisler/voltguard-ci/token && unset T
```

## Kurulum
```bash
mkdir -p ~/servisler/voltguard-ci/image
install -m 755 voltguard-ci.sh ~/servisler/voltguard-ci/
install -m 644 Dockerfile ~/servisler/voltguard-ci/image/
docker build -t voltguard-ci:ilk ~/servisler/voltguard-ci/image
sudo install -m 644 voltguard-ci.service voltguard-ci.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now voltguard-ci.timer
```

## İşletme
```bash
systemctl list-timers voltguard-ci.timer        # sonraki çalışma
sudo systemctl start voltguard-ci.service        # hemen çalıştır
journalctl -u voltguard-ci.service -n 50         # servis günlüğü
ls -t ~/servisler/voltguard-ci/logs | head       # test çıktıları
rm ~/servisler/voltguard-ci/state/<sha>          # bir commit'i yeniden test ettir
sudo systemctl disable --now voltguard-ci.timer  # durdur
```
