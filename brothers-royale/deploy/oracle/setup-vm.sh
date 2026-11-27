#!/usr/bin/env bash
# Prepara una VM Ubuntu 22.04/24.04 de Oracle Cloud (Always Free) para BROTHERS ROYALE.
# Ejecutar en la VM:  bash setup-vm.sh
# Instala Docker, abre los puertos 80/443 en el cortafuegos de la VM y clona el repositorio.
# (Además hay que abrir 80/443 en la «Security List» de la VCN desde la consola de Oracle: DEPLOY.md.)
set -euo pipefail
BRANCH="${BRANCH:-brothers-royale-phase-3.1}"
REPO="${REPO:-https://github.com/360connectpe-sys/juegos.git}"

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git iptables-persistent
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Las imágenes de Oracle traen reglas iptables que bloquean todo salvo SSH.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

if [ ! -d juegos ]; then
  git clone --branch "$BRANCH" --depth 1 "$REPO" juegos
fi
cd juegos/brothers-royale/deploy/oracle
[ -f .env ] || cp .env.example .env
echo
echo "Listo. Edita juegos/brothers-royale/deploy/oracle/.env (DOMAIN) y ejecuta:"
echo "  cd juegos/brothers-royale/deploy/oracle && sudo docker compose up -d --build"
