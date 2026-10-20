#!/bin/bash
# Build the code runner of the Vercel deployment, inside a fresh Vercel Sandbox VM, as root.
#
#   1. build the sandbox images from infra/containers with Docker (the same Dockerfiles CI builds)
#   2. export each image as a plain root filesystem plus its config (ENV, image ID)
#   3. add the files the executor bind-mounts into every step, and check every image with it
#   4. remove Docker again: the VM is then snapshotted and runs jobs without it
#
# The executor itself (kairo_exec.py) is not part of the snapshot: the API uploads the
# copy from this repository to each new VM session and installs it as
# /opt/kairo/sbin/kairo_exec.py (root-owned), so it always matches the deployed API.
#
# Usage, from a checkout of this repository inside the VM:
#     sudo bash infra/vercel/runner/build-snapshot.sh
# then snapshot the VM (Vercel API or CLI) and point the "kairo-runner" sandbox at that snapshot.
# See infra/vercel/README.md.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$REPO/infra/vercel/runner"
SPECS="gcc:13 java:21 python:3.12 node:18 go:1.23 rust:1.75 dotnet:8.0 kotlin:2.4 scripting:24.04 native:24.04 extra:24.04"
OUT=/opt/kairo/images
LOGS=/var/log/kairo-build
mkdir -p "$LOGS" "$OUT" /opt/kairo/etc

echo "==> Docker (only for the build)"
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io >"$LOGS/apt.log" 2>&1
fi
if ! docker info >/dev/null 2>&1; then
  (dockerd >"$LOGS/dockerd.log" 2>&1 &)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker info >/dev/null

echo "==> building $(echo $SPECS | wc -w) images (logs in $LOGS)"
pids=()
for spec in $SPECS; do
  name=${spec%%:*}
  (docker build -q -t "compiler-copilot/sandbox-$spec" "$REPO/infra/containers/$name" >"$LOGS/$name.log" 2>&1 \
     && echo "   built $spec" || { echo "   FAILED $spec (see $LOGS/$name.log)"; exit 1; }) &
  pids+=($!)
  # at most four builds at a time
  while [ "$(jobs -rp | wc -l)" -ge 4 ]; do sleep 1; done
done
failed=0
for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
[ "$failed" = 0 ] || { echo "image build failed"; exit 1; }

echo "==> exporting root filesystems to $OUT"
for spec in $SPECS; do
  image="compiler-copilot/sandbox-$spec"
  dir="$OUT/sandbox-${spec%%:*}"
  rm -rf "$dir" && mkdir -p "$dir/rootfs"
  cid=$(docker create "$image" true)
  docker export "$cid" | tar -C "$dir/rootfs" --numeric-owner -xpf -
  docker rm -f "$cid" >/dev/null
  docker image inspect "$image" --format '{{json .}}' | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
c = d.get("Config") or {}
print(json.dumps({"image": sys.argv[1], "id": d["Id"], "env": c.get("Env") or [],
                  "workingDir": c.get("WorkingDir") or "", "user": c.get("User") or ""}, indent=1))
' "$image" >"$dir/config.json"
  echo "   $spec: $(du -sh "$dir/rootfs" | cut -f1)"
done

echo "==> files for the sandboxes"
printf '127.0.0.1\tlocalhost sandbox\n::1\tlocalhost ip6-localhost ip6-loopback\n' >/opt/kairo/etc/hosts
printf 'sandbox\n' >/opt/kairo/etc/hostname
chmod 644 /opt/kairo/etc/hosts /opt/kairo/etc/hostname
python3 -I - <<'PY'
import json, pathlib
root = pathlib.Path("/opt/kairo/images")
manifest = {json.loads((d / "config.json").read_text())["image"]: d.name for d in sorted(root.glob("sandbox-*"))}
(root / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
print("   " + ", ".join(manifest))
PY
echo "==> checking every image with the executor"
python3 -I -S "$HERE/kairo_exec.py" health >/dev/null

echo "==> removing Docker"
pkill dockerd || true
pkill containerd || true
sleep 2
apt-get purge -y -qq docker.io containerd runc >"$LOGS/purge.log" 2>&1 || true
rm -rf /var/lib/docker /var/lib/containerd
for cg in $(find /sys/fs/cgroup -mindepth 1 -maxdepth 3 -type d -name '*docker*' 2>/dev/null | sort -r); do
  find "$cg" -depth -type d -exec rmdir {} \; 2>/dev/null || true
done
echo "==> done: $(du -sh /opt/kairo | cut -f1) in /opt/kairo"
